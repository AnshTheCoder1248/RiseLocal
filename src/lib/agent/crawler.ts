import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { backoffMs, errorText } from "@/lib/backoff";
import { Prisma, type AgentCrawlItem, type AgentRun, type AgentSource } from "@/generated/prisma/client";
import { discover } from "./discover";
import { cadenceHours, evaluateItem, fileDrafts, type SourceHints } from "./pipeline";
import type { RawItem } from "./schema";

// Checkpointed, resumable Scout crawling (AG-2), with Postgres as the only coordinator.
//
// Source lifecycle: PENDING/COMPLETED/FAILED (due once nextRunAt passes) → PROCESSING (claimed
// with FOR UPDATE SKIP LOCKED, plus a lockedBy/lockedAt lease) → COMPLETED, FAILED (retried
// with backoff), or back to PENDING when the time budget runs out mid-run.
//
// Run checkpoints: discover() output is saved as AgentCrawlItem rows. Items are processed in
// batches, and each is marked DONE in the same transaction that files its drafts. A run cut off
// by the deadline, or by a crash, resumes at the first PENDING item on the next execution.
// Overlapping executions never share a source: a claim needs an unlocked or expired lease, and
// every later write checks lockedBy.

export const CRAWL = {
  /** Renewed before every item, so it only needs to outlast one item; it expires only for a dead execution. */
  leaseMs: 6 * 60_000,
  batchSize: 10,
  maxItemAttempts: 3,
  maxSourceAttempts: 3,
  retryBaseMs: 15 * 60_000, // 15m, 30m between source retries
  /** Don't claim a new source with less than this left. Discovery alone can take ~30s. */
  minTimeToStartMs: 30_000,
  /** Delay before a run whose remaining items all errored in this execution is retried. */
  itemRetryDelayMs: 5 * 60_000,
};

type Ctx = { workerId: string; deadline: number; now: () => Date };
export type CrawlOutcome = { sourceId: string; runId?: string; result: "completed" | "paused" | "failed" | "lost_lease"; processed: number; error?: string };

/** Claim one due source (or a specific one) for this worker. Returns null when none is claimable. */
export async function claimSource(workerId: string, now: Date, opts: { sourceId?: string; exclude?: string[] } = {}) {
  const staleBefore = new Date(now.getTime() - CRAWL.leaseMs);
  const onlyId = opts.sourceId ? Prisma.sql`AND "id" = ${opts.sourceId}` : Prisma.empty;
  const exclude = opts.exclude?.length ? Prisma.sql`AND "id" NOT IN (${Prisma.join(opts.exclude)})` : Prisma.empty;
  const rows = await db.$queryRaw<{ id: string }[]>`
    UPDATE "AgentSource"
    SET "crawlStatus" = 'PROCESSING', "lockedBy" = ${workerId}, "lockedAt" = ${now}
    WHERE "id" = (
      SELECT "id" FROM "AgentSource"
      WHERE "enabled" ${onlyId} ${exclude}
        AND (
          ("crawlStatus" <> 'PROCESSING' AND ("nextRunAt" IS NULL OR "nextRunAt" <= ${now}))
          OR ("crawlStatus" = 'PROCESSING' AND "lockedAt" < ${staleBefore})
        )
      ORDER BY ("currentRunId" IS NULL), "nextRunAt" ASC NULLS FIRST, "createdAt"
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING "id"`;
  return rows[0]?.id ?? null;
}

/** Cron entry point: crawl due sources (resumed runs first) until the deadline. */
export async function crawlDueSources({ deadline, now = () => new Date() }: { deadline: number; now?: () => Date }) {
  const ctx: Ctx = { workerId: randomUUID(), deadline, now };
  const outcomes: CrawlOutcome[] = [];
  const seen: string[] = [];
  while (Date.now() < deadline - CRAWL.minTimeToStartMs) {
    const sourceId = await claimSource(ctx.workerId, now(), { exclude: seen });
    if (!sourceId) break;
    seen.push(sourceId);
    outcomes.push(await crawlClaimedSource(sourceId, ctx));
  }
  const count = (r: CrawlOutcome["result"]) => outcomes.filter((o) => o.result === r).length;
  return { sources: outcomes.length, completed: count("completed"), paused: count("paused"), failed: count("failed"), items: outcomes.reduce((n, o) => n + o.processed, 0) };
}

/** "Run now": crawl one source if no other execution holds it. */
export async function crawlSourceNow(sourceId: string, { deadline, now = () => new Date() }: { deadline: number; now?: () => Date }) {
  const ctx: Ctx = { workerId: randomUUID(), deadline, now };
  const claimed = await claimSource(ctx.workerId, now(), { sourceId });
  if (!claimed) return null; // already being crawled, or disabled
  return crawlClaimedSource(claimed, ctx);
}

const isFinished = (run: AgentRun | null) => !run || run.status === "succeeded" || run.status === "failed";

export async function crawlClaimedSource(sourceId: string, ctx: Ctx): Promise<CrawlOutcome> {
  const mine = { id: sourceId, lockedBy: ctx.workerId };
  const source = await db.agentSource.findUniqueOrThrow({ where: { id: sourceId } });
  let run: AgentRun | null = null;
  let processed = 0;
  try {
    run = source.currentRunId ? await db.agentRun.findUnique({ where: { id: source.currentRunId } }) : null;
    if (isFinished(run)) {
      const { LLM_MODEL, AGENT_PROMPT_VERSION } = env();
      run = await db.agentRun.create({ data: { sourceId, status: "running", model: LLM_MODEL, promptVer: AGENT_PROMPT_VERSION } });
      if (!(await db.agentSource.updateMany({ where: mine, data: { currentRunId: run.id } })).count) return lostLease(sourceId, run.id, processed);
    } else if (run!.status === "queued") {
      run = await db.agentRun.update({ where: { id: run!.id }, data: { status: "running", startedAt: ctx.now() } });
    }
    const activeRun = run!;

    // Checkpoint 1: discovery. Items are saved once, so a resumed run never re-fetches the source.
    if (!activeRun.discoveredAt) {
      const items = await discover(source);
      await db.$transaction([
        db.agentCrawlItem.createMany({
          data: items.map((item, position) => ({ runId: activeRun.id, position, url: item.url, payload: item as unknown as Prisma.InputJsonValue })),
          skipDuplicates: true,
        }),
        db.agentRun.update({ where: { id: activeRun.id }, data: { discoveredAt: ctx.now(), totalItems: items.length } }),
      ]);
    }

    // Checkpoint 2: items, batch by batch.
    const hints = (source.hints ?? {}) as SourceHints;
    const rejectBelow = env().SUITABILITY_REJECT_BELOW;
    const erroredThisExecution: string[] = [];
    // Renew the lease before every item (an item can take a while with LLM extraction), and stop
    // if another execution took over.
    const renewLease = async () => (await db.agentSource.updateMany({ where: mine, data: { lockedAt: ctx.now() } })).count === 1;
    for (;;) {
      if (Date.now() >= ctx.deadline) return pause(sourceId, ctx, activeRun.id, processed, 0);
      const batch = await db.agentCrawlItem.findMany({
        where: { runId: activeRun.id, status: "PENDING", id: { notIn: erroredThisExecution } },
        orderBy: { position: "asc" },
        take: CRAWL.batchSize,
      });
      if (!batch.length) break;
      for (const item of batch) {
        if (Date.now() >= ctx.deadline) break;
        if (!(await renewLease())) return lostLease(sourceId, activeRun.id, processed);
        const ok = await processCrawlItem(item, { runId: activeRun.id, hints, rejectBelow });
        if (ok) processed++;
        else erroredThisExecution.push(item.id);
      }
    }

    // Items that errored this time but have attempts left: retry the run shortly.
    const retryLater = await db.agentCrawlItem.count({ where: { runId: activeRun.id, status: "PENDING" } });
    if (retryLater) return pause(sourceId, ctx, activeRun.id, processed, CRAWL.itemRetryDelayMs);

    await finalizeRun(activeRun.id, ctx.now());
    await db.agentSource.updateMany({
      where: mine,
      data: {
        crawlStatus: "COMPLETED", currentRunId: null, lockedBy: null, lockedAt: null, crawlAttempts: 0, lastError: null,
        lastRunAt: ctx.now(), nextRunAt: new Date(ctx.now().getTime() + cadenceHours(source.frequency) * 36e5),
      },
    });
    return { sourceId, runId: activeRun.id, result: "completed", processed };
  } catch (err) {
    return failSource(source, run, ctx, err, processed);
  }
}

/**
 * Process one item. Its drafts and its DONE checkpoint commit in one transaction. The
 * `status: PENDING` guard means an item is filed at most once, even if two executions race.
 * Returns false if the item errored (it stays PENDING until it runs out of attempts).
 */
export async function processCrawlItem(item: AgentCrawlItem, ctx: { runId: string; hints: SourceHints; rejectBelow: number }) {
  try {
    const evaluation = await evaluateItem(item.payload as unknown as RawItem, ctx.hints, ctx.rejectBelow);
    await db.$transaction(
      async (tx) => {
        const drafted = await fileDrafts(tx, evaluation.accepted, { runId: ctx.runId, url: item.url, hints: ctx.hints });
        const { count } = await tx.agentCrawlItem.updateMany({
          where: { id: item.id, status: "PENDING" },
          data: {
            status: "DONE", attempts: { increment: 1 }, processedAt: new Date(), error: null,
            found: evaluation.found, drafted, rejected: evaluation.rejected, tokens: evaluation.tokens, costUsd: evaluation.costUsd,
            rejections: evaluation.rejections,
          },
        });
        if (!count) throw new AlreadyProcessed(); // roll back: someone else finished it
      },
      { timeout: 15_000 },
    );
    return true;
  } catch (err) {
    if (err instanceof AlreadyProcessed) return true;
    const attempts = item.attempts + 1;
    const exhausted = attempts >= CRAWL.maxItemAttempts;
    await db.agentCrawlItem.updateMany({
      where: { id: item.id, status: "PENDING" },
      data: { attempts, error: errorText(err), ...(exhausted && { status: "FAILED", processedAt: new Date() }) },
    });
    console.error(`[agent] item ${item.id} (run ${ctx.runId}) failed, attempt ${attempts}/${CRAWL.maxItemAttempts}`, err);
    return false;
  }
}

class AlreadyProcessed extends Error {}

/** Sum the per-item checkpoints into the run. Safe to call more than once. */
export async function finalizeRun(runId: string, now: Date, status: "succeeded" | "failed" = "succeeded", error?: string) {
  const [sums, failedItems, withRejections] = await Promise.all([
    db.agentCrawlItem.aggregate({ where: { runId }, _sum: { found: true, drafted: true, rejected: true, tokens: true, costUsd: true } }),
    db.agentCrawlItem.count({ where: { runId, status: "FAILED" } }),
    db.agentCrawlItem.findMany({ where: { runId, NOT: { rejections: { equals: Prisma.DbNull } } }, select: { rejections: true }, orderBy: { position: "asc" }, take: 500 }),
  ]);
  const rejections = withRejections.flatMap((r) => (Array.isArray(r.rejections) ? r.rejections : [])).slice(0, 200) as Prisma.InputJsonValue[];
  await db.agentRun.update({
    where: { id: runId },
    data: {
      status, finishedAt: now,
      found: sums._sum.found ?? 0, drafted: sums._sum.drafted ?? 0, rejected: sums._sum.rejected ?? 0,
      tokens: sums._sum.tokens ?? 0, costUsd: sums._sum.costUsd ?? 0, rejections,
      error: error ?? (failedItems ? `${failedItems} item(s) failed after ${CRAWL.maxItemAttempts} attempts` : null),
    },
  });
}

/** Release the source to resume later. The run stays "running" with its checkpoint. */
async function pause(sourceId: string, ctx: Ctx, runId: string, processed: number, delayMs: number): Promise<CrawlOutcome> {
  await db.agentSource.updateMany({
    where: { id: sourceId, lockedBy: ctx.workerId },
    data: { crawlStatus: "PENDING", lockedBy: null, lockedAt: null, nextRunAt: delayMs ? new Date(ctx.now().getTime() + delayMs) : null },
  });
  return { sourceId, runId, result: "paused", processed };
}

function lostLease(sourceId: string, runId: string | undefined, processed: number): CrawlOutcome {
  console.warn(`[agent] lost the lease on source ${sourceId}; another execution took over`);
  return { sourceId, runId, result: "lost_lease", processed };
}

async function failSource(source: AgentSource, run: AgentRun | null, ctx: Ctx, err: unknown, processed: number): Promise<CrawlOutcome> {
  const error = errorText(err);
  const attempts = source.crawlAttempts + 1;
  const giveUp = attempts >= CRAWL.maxSourceAttempts;
  // Keep a discovered run to resume, unless we're giving up on it.
  const keepRun = !!run?.discoveredAt && !giveUp;
  if (run && !keepRun) {
    await finalizeRun(run.id, ctx.now(), "failed", error).catch((e) => console.error(`[agent] could not finalize run ${run.id}`, e));
  }
  const nextRunAt = giveUp
    ? new Date(ctx.now().getTime() + cadenceHours(source.frequency) * 36e5) // try again next cycle
    : new Date(ctx.now().getTime() + backoffMs(attempts, { baseMs: CRAWL.retryBaseMs }));
  await db.agentSource.updateMany({
    where: { id: source.id, lockedBy: ctx.workerId },
    data: {
      crawlStatus: "FAILED", lockedBy: null, lockedAt: null, lastError: error, nextRunAt,
      crawlAttempts: giveUp ? 0 : attempts, ...(!keepRun && { currentRunId: null }), ...(giveUp && { lastRunAt: ctx.now() }),
    },
  });
  const level = giveUp ? "error" : "warn";
  console[level](`[agent] source ${source.id} failed (attempt ${attempts}/${CRAWL.maxSourceAttempts})${giveUp ? ", giving up until next cycle" : ""}: ${error}`);
  return { sourceId: source.id, runId: run?.id, result: "failed", processed, error };
}
