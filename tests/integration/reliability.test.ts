// Runs the reliability SQL against a real Postgres. Skipped unless TEST_DATABASE_URL is set.
// Use a throwaway database (e.g. a Neon branch), migrated with:
//   DATABASE_URL=$TEST_DATABASE_URL DIRECT_URL=$TEST_DATABASE_URL npx prisma migrate deploy
// The tests only delete rows from the reliability tables and the sources they create.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tasks", () => ({ runTask: vi.fn(), runTaskNow: vi.fn().mockResolvedValue(null) }));

const enabled = !!process.env.TEST_DATABASE_URL;

describe.skipIf(!enabled)("reliability (real Postgres)", async () => {
  const { db } = await import("@/lib/db");
  const { claimOutboxBatch, deliverOutbox, enqueueEmail, OUTBOX } = await import("@/lib/outbox");
  const { consume, hashKey } = await import("@/lib/rate-limit");
  const { acquireCronLock, runCronTask } = await import("@/lib/cron");
  const { claimSource } = await import("@/lib/agent/crawler");
  const PREFIX = `itest-${process.pid}-`;

  beforeEach(async () => {
    await db.emailOutbox.deleteMany({ where: { idempotencyKey: { startsWith: PREFIX } } });
    await db.cronRun.deleteMany({ where: { task: { startsWith: PREFIX } } });
    await db.cronLock.deleteMany({ where: { task: { startsWith: PREFIX } } });
    await db.agentSource.deleteMany({ where: { name: { startsWith: PREFIX } } });
  });
  afterAll(async () => {
    await db.emailOutbox.deleteMany({ where: { idempotencyKey: { startsWith: PREFIX } } });
    await db.agentSource.deleteMany({ where: { name: { startsWith: PREFIX } } });
    await db.$disconnect();
  });

  it("outbox: duplicate enqueues collapse to one row, even concurrently", async () => {
    const key = `${PREFIX}dup`;
    const results = await Promise.all(Array.from({ length: 10 }, () => enqueueEmail({ to: "a@example.com", subject: "s", text: "t", idempotencyKey: key })));
    expect(results.filter((r) => r.enqueued)).toHaveLength(1);
    expect(await db.emailOutbox.count({ where: { idempotencyKey: key } })).toBe(1);
  });

  it("outbox: concurrent claims never return the same row (SKIP LOCKED)", async () => {
    for (let i = 0; i < 20; i++) await enqueueEmail({ to: "a@example.com", subject: "s", text: "t", idempotencyKey: `${PREFIX}c${i}` });
    const now = new Date(Date.now() + 1000);
    const batches = await Promise.all(Array.from({ length: 5 }, (_, i) => claimOutboxBatch(`w${i}`, 6, now)));
    const ids = batches.flat().map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    const mine = await db.emailOutbox.count({ where: { idempotencyKey: { startsWith: `${PREFIX}c` }, status: "PROCESSING" } });
    expect(mine).toBe(ids.length);
  });

  it("outbox: retry, backoff and permanent failure persist correctly", async () => {
    const key = `${PREFIX}retry`;
    await enqueueEmail({ to: "a@example.com", subject: "s", text: "t", idempotencyKey: key });
    const send = vi.fn().mockRejectedValue(new Error("503"));
    let clock = Date.now() + 1000;
    for (let i = 0; i < OUTBOX.maxAttempts; i++) {
      await deliverOutbox({ send, now: () => new Date(clock), random: () => 0.5 });
      const row = await db.emailOutbox.findUniqueOrThrow({ where: { idempotencyKey: key } });
      clock = row.nextAttemptAt.getTime() + 1;
    }
    const row = await db.emailOutbox.findUniqueOrThrow({ where: { idempotencyKey: key } });
    expect(row).toMatchObject({ status: "FAILED", attempts: OUTBOX.maxAttempts });
  });

  it("rate limit: concurrent hits are counted atomically", async () => {
    const rule = { key: `${PREFIX}rl:${Date.now()}`, limit: 5, windowMs: 60_000 };
    const results = await Promise.all(Array.from({ length: 30 }, () => consume(rule)));
    expect(results.filter((r) => r.allowed)).toHaveLength(5);
    expect(results.map((r) => r.count).sort((a, b) => a - b)).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
    await db.rateLimitBucket.delete({ where: { key: hashKey(rule.key) } });
  });

  it("cron: only one of many concurrent lock attempts wins", async () => {
    const task = `${PREFIX}lock`;
    const wins = await Promise.all(Array.from({ length: 10 }, (_, i) => acquireCronLock(task, `run-${i}`)));
    expect(wins.filter(Boolean)).toHaveLength(1);
  });

  it("cron: overlapping executions are skipped and recorded", async () => {
    const task = `${PREFIX}overlap`;
    let release!: () => void;
    const first = runCronTask(task, () => new Promise<void>((r) => (release = r)));
    await vi.waitFor(async () => expect(await db.cronRun.count({ where: { task, status: "RUNNING" } })).toBe(1));
    expect((await runCronTask(task, async () => null)).status).toBe("SKIPPED");
    release();
    expect((await first).status).toBe("SUCCEEDED");
    expect((await db.cronRun.findMany({ where: { task } })).map((r) => r.status).sort()).toEqual(["SKIPPED", "SUCCEEDED"]);
  });

  it("crawler: concurrent claims hand a source to exactly one execution", async () => {
    const s = await db.agentSource.create({ data: { name: `${PREFIX}src`, type: "json_api", url: "https://example.com", frequency: "every 6h" } });
    const now = new Date();
    const claims = await Promise.all(Array.from({ length: 8 }, (_, i) => claimSource(`w${i}`, now, { sourceId: s.id })));
    expect(claims.filter(Boolean)).toEqual([s.id]);
  });
});
