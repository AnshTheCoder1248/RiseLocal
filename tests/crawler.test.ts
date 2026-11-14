/* eslint-disable @typescript-eslint/no-explicit-any -- tests drive the untyped in-memory Prisma fake */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", async () => ({ db: (await import("./helpers/fake-db")).createFakeDb() }));
vi.mock("@/lib/agent/discover", () => ({ discover: vi.fn() }));
vi.mock("@/lib/agent/pipeline", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/agent/pipeline")>()),
  evaluateItem: vi.fn(),
  fileDrafts: vi.fn(),
}));

import { db } from "@/lib/db";
import { discover } from "@/lib/agent/discover";
import { evaluateItem, fileDrafts, type ItemEvaluation } from "@/lib/agent/pipeline";
import { claimSource, CRAWL, crawlDueSources, crawlSourceNow, processCrawlItem } from "@/lib/agent/crawler";

const fake = db as any;
const source = () => fake.tables.agentSource[0];
const items = () => fake.tables.agentCrawlItem ?? [];
const run = () => fake.tables.agentRun.find((r: any) => r.id === (source().currentRunId ?? fake.tables.agentRun.at(-1).id));
const rawItems = (n: number) => Array.from({ length: n }, (_, i) => ({ url: `https://jobs.example/${i}`, fields: { title: `Job ${i}` } }));
const evaluation = (drafts = 1) =>
  ({ found: drafts, rejected: 0, rejections: [], tokens: 10, costUsd: 0.001, accepted: Array.from({ length: drafts }, () => ({})) }) as unknown as ItemEvaluation;

beforeEach(() => {
  for (const k of Object.keys(fake.tables)) delete fake.tables[k];
  fake.tables.agentSource = [{ id: "src1", name: "Board", type: "json_api", url: "https://jobs.example/api", frequency: "every 6h", hints: {}, enabled: true, crawlStatus: "PENDING", nextRunAt: null, currentRunId: null, lockedBy: null, lockedAt: null, crawlAttempts: 0, lastError: null, lastRunAt: null, createdAt: new Date() }];
  fake.tables.agentRun = [];
  vi.mocked(evaluateItem).mockReset().mockResolvedValue(evaluation());
  vi.mocked(fileDrafts).mockReset().mockResolvedValue(1);
  vi.mocked(discover).mockReset().mockResolvedValue(rawItems(25));
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Scout crawling: checkpoints", () => {
  it("stops at the deadline and resumes where it left off without re-discovering", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    // Each item "takes" one second.
    vi.mocked(evaluateItem).mockImplementation(async () => {
      vi.advanceTimersByTime(1000);
      return evaluation();
    });

    const first = await crawlSourceNow("src1", { deadline: Date.now() + 10_500 });
    expect(first).toMatchObject({ result: "paused", processed: 11 });
    expect(source()).toMatchObject({ crawlStatus: "PENDING", lockedBy: null, nextRunAt: null });
    expect(source().currentRunId).toBeTruthy();
    expect(items().filter((i: any) => i.status === "DONE")).toHaveLength(11);
    expect(run().status).toBe("running");

    const second = await crawlDueSources({ deadline: Date.now() + 250_000 });
    expect(second).toMatchObject({ sources: 1, completed: 1, items: 14 });
    expect(discover).toHaveBeenCalledTimes(1); // the checkpointed item list was reused
    expect(evaluateItem).toHaveBeenCalledTimes(25); // no item processed twice

    const finished = fake.tables.agentRun[0];
    expect(finished).toMatchObject({ status: "succeeded", found: 25, drafted: 25, totalItems: 25, error: null });
    expect(source()).toMatchObject({ crawlStatus: "COMPLETED", currentRunId: null, lockedBy: null, crawlAttempts: 0 });
    expect(source().nextRunAt.getTime() - Date.now()).toBe(6 * 36e5);
  });

  it("doesn't start a new source with too little time left", async () => {
    expect(await crawlDueSources({ deadline: Date.now() + CRAWL.minTimeToStartMs - 1 })).toMatchObject({ sources: 0 });
    expect(source().crawlStatus).toBe("PENDING");
  });

  it("isn't due again until nextRunAt", async () => {
    await crawlDueSources({ deadline: Date.now() + 250_000 });
    expect(await crawlDueSources({ deadline: Date.now() + 250_000 })).toMatchObject({ sources: 0 });
    expect(discover).toHaveBeenCalledTimes(1);
  });
});

describe("Scout crawling: overlapping executions", () => {
  it("only one execution can claim a source", async () => {
    const now = new Date();
    const [a, b] = await Promise.all([claimSource("worker-a", now), claimSource("worker-b", now)]);
    expect([a, b].filter(Boolean)).toEqual(["src1"]);
    expect(await crawlSourceNow("src1", { deadline: Date.now() + 60_000 })).toBeNull();
  });

  it("a crashed execution's source is reclaimed after the lease expires and resumes its run", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.mocked(evaluateItem).mockImplementation(async () => {
      vi.advanceTimersByTime(1000);
      return evaluation();
    });
    // Earlier work: 6 items checkpointed.
    await crawlSourceNow("src1", { deadline: Date.now() + 5_500 });
    const runId = source().currentRunId;
    expect(items().filter((i: any) => i.status === "DONE")).toHaveLength(6);

    // Execution A claims the source and then dies (function timeout) without releasing it.
    expect(await claimSource("dead-worker", new Date())).toBe("src1");

    // While A's lease is live, nobody else can take the source.
    expect(await claimSource("worker-b", new Date())).toBeNull();
    // Once it expires, the next cron execution reclaims it and resumes the same run.
    vi.advanceTimersByTime(CRAWL.leaseMs + 1000);
    const outcome = await crawlDueSources({ deadline: Date.now() + 250_000 });
    expect(outcome).toMatchObject({ completed: 1, items: 19 });
    expect(fake.tables.agentRun).toHaveLength(1);
    expect(fake.tables.agentRun[0]).toMatchObject({ id: runId, status: "succeeded", drafted: 25 });
    expect(evaluateItem).toHaveBeenCalledTimes(25);
  });

  it("stops work as soon as another execution takes over its lease", async () => {
    vi.mocked(evaluateItem).mockImplementation(async () => {
      source().lockedBy = "worker-b"; // lease stolen mid-batch
      return evaluation();
    });
    const outcome = await crawlSourceNow("src1", { deadline: Date.now() + 250_000 });
    expect(outcome?.result).toBe("lost_lease");
    expect(evaluateItem).toHaveBeenCalledTimes(1); // stopped before the next item
    expect(source().lockedBy).toBe("worker-b"); // didn't clobber the new owner
  });
});

describe("Scout crawling: idempotency", () => {
  it("an item already marked DONE isn't filed again (transaction rolls back)", async () => {
    vi.mocked(discover).mockResolvedValue(rawItems(1));
    await crawlSourceNow("src1", { deadline: Date.now() + 250_000 });
    const item = items()[0];
    expect(item.status).toBe("DONE");

    vi.mocked(fileDrafts).mockImplementation(async (tx: any) => {
      await tx.agentDraft.create({ data: { fingerprint: "dup" } });
      return 1;
    });
    // A racing execution holding a stale copy of the row (status PENDING) tries again.
    expect(await processCrawlItem({ ...item, status: "PENDING" }, { runId: item.runId, hints: {}, rejectBelow: 0.65 })).toBe(true);
    expect(fake.tables.agentDraft ?? []).toHaveLength(0);
    expect(items()[0].drafted).toBe(1);
  });

  it("re-discovery of the same run doesn't duplicate items", async () => {
    await crawlSourceNow("src1", { deadline: Date.now() + 250_000 });
    const runId = fake.tables.agentRun[0].id;
    const { count } = await fake.agentCrawlItem.createMany({ data: rawItems(25).map((it, position) => ({ runId, position, url: it.url, payload: it })), skipDuplicates: true });
    expect(count).toBe(0);
    expect(items()).toHaveLength(25);
  });
});

describe("Scout crawling: failures", () => {
  it("retries a failing item, then marks it FAILED and completes the run", async () => {
    vi.mocked(discover).mockResolvedValue(rawItems(3));
    vi.mocked(evaluateItem).mockImplementation(async (item: any) => {
      if (item.url.endsWith("/1")) throw new Error("LLM timeout");
      return evaluation();
    });
    let clock = Date.now();
    vi.useFakeTimers({ toFake: ["Date"], now: clock });

    const first = await crawlDueSources({ deadline: Date.now() + 250_000 });
    expect(first.paused).toBe(1);
    expect(items()[1]).toMatchObject({ status: "PENDING", attempts: 1, error: "LLM timeout" });
    expect(source().nextRunAt.getTime() - Date.now()).toBe(CRAWL.itemRetryDelayMs);

    for (let i = 0; i < CRAWL.maxItemAttempts - 1; i++) {
      clock += CRAWL.itemRetryDelayMs;
      vi.setSystemTime(clock);
      await crawlDueSources({ deadline: Date.now() + 250_000 });
    }
    expect(items()[1]).toMatchObject({ status: "FAILED", attempts: CRAWL.maxItemAttempts });
    expect(fake.tables.agentRun[0]).toMatchObject({ status: "succeeded", drafted: 2, error: expect.stringContaining("1 item(s) failed") });
    expect(source().crawlStatus).toBe("COMPLETED");
  });

  it("backs off after a discovery failure, then gives up until the next cycle", async () => {
    vi.mocked(discover).mockRejectedValue(new Error("Fetch → 503"));
    let clock = Date.now();
    vi.useFakeTimers({ toFake: ["Date"], now: clock });

    for (let attempt = 1; attempt <= CRAWL.maxSourceAttempts; attempt++) {
      const out = await crawlDueSources({ deadline: Date.now() + 250_000 });
      expect(out.failed).toBe(1);
      expect(source()).toMatchObject({ crawlStatus: "FAILED", lastError: "Fetch → 503", lockedBy: null, currentRunId: null });
      if (attempt < CRAWL.maxSourceAttempts) {
        expect(source().crawlAttempts).toBe(attempt);
        const delay = source().nextRunAt.getTime() - clock;
        expect(delay).toBeGreaterThanOrEqual(0.8 * CRAWL.retryBaseMs * 2 ** (attempt - 1));
        // Not due during the backoff.
        expect(await crawlDueSources({ deadline: Date.now() + 250_000 })).toMatchObject({ sources: 0 });
        clock = source().nextRunAt.getTime();
        vi.setSystemTime(clock);
      } else {
        expect(source().crawlAttempts).toBe(0);
        expect(source().nextRunAt.getTime() - clock).toBe(6 * 36e5);
      }
    }
    expect(fake.tables.agentRun.every((r: any) => r.status === "failed")).toBe(true);
  });

  it("one failing source doesn't stop the others", async () => {
    fake.tables.agentSource.push({ ...source(), id: "src2", url: "https://other.example/api", createdAt: new Date(Date.now() + 1) });
    vi.mocked(discover).mockImplementation(async (s: any) => {
      if (s.url.includes("jobs.example")) throw new Error("boom");
      return rawItems(2);
    });
    const out = await crawlDueSources({ deadline: Date.now() + 250_000 });
    expect(out).toMatchObject({ sources: 2, failed: 1, completed: 1 });
  });
});
