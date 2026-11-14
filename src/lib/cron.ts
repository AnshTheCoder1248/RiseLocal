import { randomUUID, timingSafeEqual } from "node:crypto";
import { db } from "./db";
import { errorText } from "./backoff";
import type { Prisma } from "@/generated/prisma/client";

// Cron execution tracking and overlap protection, Postgres only.
//
// - Each invocation is recorded in CronRun (status, start/finish time, duration, result, error).
// - A CronLock lease row lets only one execution of a task run at a time. Overlapping
//   invocations are recorded as SKIPPED. A crashed execution's lease expires on its own
//   (lockedUntil), and the next execution marks its CronRun as FAILED (interrupted).
// - Failed daily tasks are re-run by the hourly `retry-failed` task, up to MAX_TASK_ATTEMPTS.
//   Tasks that resume their own work (crawling, email outbox) don't need this.

/** The cron route's maxDuration. */
export const CRON_MAX_DURATION_S = 300;
/** Work budget per execution, leaving headroom to record the result before the hard limit. */
export const CRON_BUDGET_MS = 250_000;
/** Lease length. Longer than maxDuration, so a lease only outlives a dead execution. */
export const CRON_LEASE_MS = (CRON_MAX_DURATION_S + 30) * 1000;
export const MAX_TASK_ATTEMPTS = 3;
const RETRY_WINDOW_MS = 20 * 36e5;

export type CronContext = { runId: string; deadline: number; attempt: number };
export type CronOutcome = { task: string; runId: string; status: "SUCCEEDED" | "FAILED" | "SKIPPED"; attempt: number; durationMs: number; result?: unknown; error?: string };

/** Constant-time check of `Authorization: Bearer $CRON_SECRET`. Without a secret, only `next dev` is allowed. */
export function isAuthorizedCron(authorization: string | null, secret = process.env.CRON_SECRET, nodeEnv = process.env.NODE_ENV) {
  if (!secret) return nodeEnv === "development";
  const given = Buffer.from(authorization ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Take the task's lease if it's free or expired. Returns false if another execution holds it. */
export async function acquireCronLock(task: string, runId: string, now = new Date(), leaseMs = CRON_LEASE_MS) {
  const lockedUntil = new Date(now.getTime() + leaseMs);
  const rows = await db.$queryRaw<{ runId: string }[]>`
    INSERT INTO "CronLock" ("task", "runId", "lockedUntil") VALUES (${task}, ${runId}, ${lockedUntil})
    ON CONFLICT ("task") DO UPDATE SET "runId" = EXCLUDED."runId", "lockedUntil" = EXCLUDED."lockedUntil"
    WHERE "CronLock"."lockedUntil" < ${now}
    RETURNING "runId"`;
  return rows.length === 1;
}

export async function releaseCronLock(task: string, runId: string) {
  await db.cronLock.deleteMany({ where: { task, runId } });
}

/** Run `fn` as cron task `task`, with run tracking and overlap protection. Never throws. */
export async function runCronTask(
  task: string,
  fn: (ctx: CronContext) => Promise<unknown>,
  /** leaseMs: lock lifetime. It must outlast the execution (default fits a 300s Vercel function). */
  opts: { attempt?: number; deadline?: number; leaseMs?: number } = {},
): Promise<CronOutcome> {
  const runId = randomUUID();
  const attempt = opts.attempt ?? 1;
  const started = Date.now();
  const deadline = opts.deadline ?? started + CRON_BUDGET_MS;

  if (!(await acquireCronLock(task, runId, new Date(), opts.leaseMs))) {
    await db.cronRun.create({ data: { id: runId, task, status: "SKIPPED", attempt, finishedAt: new Date(), durationMs: 0, error: "Another execution of this task is still running" } });
    console.info(`[cron] ${task} skipped: another execution holds the lock`);
    return { task, runId, status: "SKIPPED", attempt, durationMs: 0 };
  }

  try {
    await db.cronRun.create({ data: { id: runId, task, status: "RUNNING", attempt } });
    // We hold the lock, so any other RUNNING row for this task belongs to a dead execution.
    await db.cronRun.updateMany({
      where: { task, status: "RUNNING", id: { not: runId } },
      data: { status: "FAILED", finishedAt: new Date(), error: "Interrupted: the execution crashed or hit the time limit before finishing" },
    });

    try {
      const result = await fn({ runId, deadline, attempt });
      const durationMs = Date.now() - started;
      await db.cronRun.update({
        where: { id: runId },
        data: { status: "SUCCEEDED", finishedAt: new Date(), durationMs, result: (result ?? null) as Prisma.InputJsonValue },
      });
      return { task, runId, status: "SUCCEEDED", attempt, durationMs, result };
    } catch (err) {
      const durationMs = Date.now() - started;
      const error = errorText(err, 2000);
      console.error(`[cron] ${task} failed (attempt ${attempt})`, err);
      await db.cronRun.update({ where: { id: runId }, data: { status: "FAILED", finishedAt: new Date(), durationMs, error } });
      return { task, runId, status: "FAILED", attempt, durationMs, error };
    }
  } finally {
    await releaseCronLock(task, runId).catch((err) => console.error(`[cron] could not release lock for ${task}`, err));
  }
}

type CronTaskFn = (ctx: CronContext) => Promise<unknown>;

/**
 * URL slug → task, served by /api/cron/[task]. Vercel Cron (vercel.json) schedules all of them
 * except agent-schedule, which GitHub Actions runs as a long-lived worker (scripts/crawl.ts).
 * The route still accepts it as a manual fallback, and the shared lock keeps the two apart.
 */
export const CRON_TASKS: Record<string, CronTaskFn> = {
  "agent-schedule": async ({ deadline }) => (await import("./tasks")).runTaskNow("agent:schedule", { deadline }),
  "jobs-expire": async ({ deadline }) => (await import("./tasks")).runTaskNow("jobs:expire", { deadline }),
  "notify-digest": async ({ deadline }) => (await import("./tasks")).runTaskNow("notify:digest", { deadline }),
  "email-outbox": async ({ deadline }) => (await import("./tasks")).runTaskNow("email:deliver", { deadline }),
  "retry-failed": ({ deadline }) => retryFailedTasks(deadline),
};

/** Daily tasks that don't resume their own work, so a failed run is re-run here. */
export const RETRYABLE_TASKS = ["jobs-expire", "notify-digest"] as const;

/**
 * Find retryable tasks whose latest run failed (or was interrupted), still has attempts left,
 * and is recent enough that the next scheduled run isn't about to replace it.
 */
export async function findTasksToRetry(now = new Date()) {
  const due: { task: string; attempt: number }[] = [];
  for (const task of RETRYABLE_TASKS) {
    const latest = await db.cronRun.findFirst({ where: { task, status: { not: "SKIPPED" } }, orderBy: { startedAt: "desc" } });
    if (!latest || now.getTime() - latest.startedAt.getTime() > RETRY_WINDOW_MS) continue;
    const interrupted = latest.status === "RUNNING" && now.getTime() - latest.startedAt.getTime() > CRON_LEASE_MS;
    if ((latest.status === "FAILED" || interrupted) && latest.attempt < MAX_TASK_ATTEMPTS) due.push({ task, attempt: latest.attempt + 1 });
  }
  return due;
}

export async function retryFailedTasks(deadline: number) {
  const outcomes: Pick<CronOutcome, "task" | "status" | "attempt" | "error">[] = [];
  for (const { task, attempt } of await findTasksToRetry()) {
    if (Date.now() >= deadline - 30_000) break;
    const o = await runCronTask(task, CRON_TASKS[task], { attempt, deadline });
    outcomes.push({ task: o.task, status: o.status, attempt: o.attempt, error: o.error });
    if (o.status === "FAILED" && attempt >= MAX_TASK_ATTEMPTS) {
      console.error(`[cron] ${task} failed ${attempt} times in a row; giving up until its next scheduled run`);
    }
  }
  return { retried: outcomes };
}
