/* eslint-disable @typescript-eslint/no-explicit-any -- tests drive the untyped in-memory Prisma fake */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", async () => ({ db: (await import("./helpers/fake-db")).createFakeDb() }));
vi.mock("@/lib/agent/crawler", () => ({ crawlDueSources: vi.fn().mockResolvedValue({ sources: 2, completed: 2 }) }));

import { db } from "@/lib/db";
import { crawlDueSources } from "@/lib/agent/crawler";
import { CRAWL_TASK, DEFAULT_BUDGET_MIN, exitCodeFor, leaseFor, parseBudgetMinutes, runScheduledCrawl } from "@/lib/agent/worker";
import { runCronTask } from "@/lib/cron";

const fake = db as any;
beforeEach(() => {
  for (const k of Object.keys(fake.tables)) delete fake.tables[k];
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("GitHub Actions crawl worker", () => {
  it("parses and clamps the budget input", () => {
    expect(parseBudgetMinutes(undefined)).toBe(DEFAULT_BUDGET_MIN);
    expect(parseBudgetMinutes("")).toBe(DEFAULT_BUDGET_MIN);
    expect(parseBudgetMinutes("abc; rm -rf /")).toBe(DEFAULT_BUDGET_MIN);
    expect(parseBudgetMinutes("-5")).toBe(DEFAULT_BUDGET_MIN);
    expect(parseBudgetMinutes("10.9")).toBe(10);
    expect(parseBudgetMinutes("9999")).toBe(300);
  });

  it("records the run as agent-schedule and passes the budget as the deadline", async () => {
    const now = Date.now();
    const outcome = await runScheduledCrawl({ budgetMs: 25 * 60_000, now });
    expect(outcome).toMatchObject({ task: CRAWL_TASK, status: "SUCCEEDED", result: { sources: 2, completed: 2 } });
    expect(crawlDueSources).toHaveBeenCalledWith({ deadline: now + 25 * 60_000 });
    expect(fake.tables.cronRun[0]).toMatchObject({ task: "agent-schedule", status: "SUCCEEDED" });
  });

  it("holds the lock for the whole budget, so a Vercel-side trigger mid-run is skipped", async () => {
    let finish!: () => void;
    vi.mocked(crawlDueSources).mockImplementationOnce(() => new Promise((r) => (finish = () => r({} as any))));
    const longRun = runScheduledCrawl({ budgetMs: 25 * 60_000 });
    await vi.waitFor(() => expect(fake.tables.cronLock).toHaveLength(1));
    // The lease covers the 25-minute run, not just the 330s default for Vercel functions.
    expect(fake.tables.cronLock[0].lockedUntil.getTime()).toBeGreaterThan(Date.now() + 25 * 60_000);
    expect((await runCronTask(CRAWL_TASK, async () => "manual")).status).toBe("SKIPPED");
    finish();
    expect((await longRun).status).toBe("SUCCEEDED");
  });

  it("fails the job only when the crawl failed", async () => {
    vi.mocked(crawlDueSources).mockRejectedValueOnce(new Error("db unreachable"));
    const outcome = await runScheduledCrawl({ budgetMs: 60_000 });
    expect(outcome.status).toBe("FAILED");
    expect(exitCodeFor(outcome)).toBe(1);
    expect(exitCodeFor({ status: "SKIPPED" })).toBe(0);
    expect(exitCodeFor({ status: "SUCCEEDED" })).toBe(0);
  });

  it("leases cover the budget plus slack", () => {
    expect(leaseFor(60_000)).toBe(6 * 60_000);
  });
});
