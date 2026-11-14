-- Postgres-only reliability layer: email outbox, crawl checkpoints, shared rate limits, cron run tracking.

-- CreateEnum
CREATE TYPE "CrawlStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "CrawlItemStatus" AS ENUM ('PENDING', 'DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "CronRunStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED');

-- AlterTable
ALTER TABLE "AgentSource" ADD COLUMN     "crawlAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "crawlStatus" "CrawlStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "currentRunId" TEXT,
ADD COLUMN     "lastError" TEXT,
ADD COLUMN     "lockedAt" TIMESTAMP(3),
ADD COLUMN     "lockedBy" TEXT,
ADD COLUMN     "nextRunAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "AgentRun" ADD COLUMN     "discoveredAt" TIMESTAMP(3),
ADD COLUMN     "totalItems" INTEGER;

-- CreateTable
CREATE TABLE "AgentCrawlItem" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "CrawlItemStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "found" INTEGER NOT NULL DEFAULT 0,
    "drafted" INTEGER NOT NULL DEFAULT 0,
    "rejected" INTEGER NOT NULL DEFAULT 0,
    "rejections" JSONB,
    "tokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "error" TEXT,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "AgentCrawlItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailOutbox" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedBy" TEXT,
    "lockedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "providerMessageId" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimitBucket" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "resetAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "CronRun" (
    "id" TEXT NOT NULL,
    "task" TEXT NOT NULL,
    "status" "CronRunStatus" NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "result" JSONB,
    "error" TEXT,

    CONSTRAINT "CronRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CronLock" (
    "task" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "lockedUntil" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CronLock_pkey" PRIMARY KEY ("task")
);

-- CreateIndex
CREATE INDEX "AgentCrawlItem_runId_status_idx" ON "AgentCrawlItem"("runId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AgentCrawlItem_runId_position_key" ON "AgentCrawlItem"("runId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "EmailOutbox_idempotencyKey_key" ON "EmailOutbox"("idempotencyKey");

-- CreateIndex
CREATE INDEX "EmailOutbox_status_nextAttemptAt_idx" ON "EmailOutbox"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "RateLimitBucket_resetAt_idx" ON "RateLimitBucket"("resetAt");

-- CreateIndex
CREATE INDEX "CronRun_task_startedAt_idx" ON "CronRun"("task", "startedAt");

-- CreateIndex
CREATE INDEX "AgentSource_enabled_crawlStatus_nextRunAt_idx" ON "AgentSource"("enabled", "crawlStatus", "nextRunAt");

-- AddForeignKey
ALTER TABLE "AgentCrawlItem" ADD CONSTRAINT "AgentCrawlItem_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Backfill: sources that have already run keep their cadence instead of all crawling at once.
UPDATE "AgentSource"
SET "crawlStatus" = 'COMPLETED',
    "nextRunAt" = "lastRunAt" + make_interval(hours => coalesce(substring("frequency" from '(\d+)h')::int, 6))
WHERE "lastRunAt" IS NOT NULL;
