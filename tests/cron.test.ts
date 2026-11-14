/* eslint-disable @typescript-eslint/no-explicit-any -- tests drive the untyped in-memory Prisma fake */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", async () => ({ db: (await import("./helpers/fake-db")).createFakeDb() }));
vi.mock("@/lib/tasks", () => ({ runTask: vi.fn(), runTaskNow: vi.fn().mockResolvedValue({ ok: true }) }));

import { db } from "@/lib/db";
import { runTaskNow } from "@/lib/tasks";
import { CRON_LEASE_MS, findTasksToRetry, isAuthorizedCron, MAX_TASK_ATTEMPTS, retryFailedTasks, runCronTask } from "@/lib/cron";

const fake = db as any;
const runs = (task?: string) => (fake.tables.cronRun ?? []).filter((r: any) => !task || r.task === task);

beforeEach(() => {
  for (const k of Object.keys(fake.tables)) delete fake.tables[k];
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("cron auth", () => {
  const secret = "s".repeat(32);
  it("requires the exact bearer secret", () => {
    expect(isAuthorizedCron(`Bearer ${secret}`, secret, "production")).toBe(true);
    expect(isAuthorizedCron(`Bearer ${secret}x`, secret, "production")).toBe(false);
    expect(isAuthorizedCron(null, secret, "production")).toBe(false);
    expect(isAuthorizedCron(secret, secret, "production")).toBe(false);
  });
  it("without a secret, allows only local development", () => {
    expect(isAuthorizedCron(null, undefined, "development")).toBe(true);
    expect(isAuthorizedCron(null, undefined, "production")).toBe(false);
    expect(isAuthorizedCron(null, undefined, "test")).toBe(false);
  });
});

describe("cron execution tracking", () => {
  it("records a successful run with timing and result, and releases the lock", async () => {
    const outcome = await runCronTask("jobs-expire", async () => ({ expired: 3 }));
    expect(outcome.status).toBe("SUCCEEDED");
    const [run] = runs("jobs-expire");
    expect(run).toMatchObject({ status: "SUCCEEDED", attempt: 1, result: { expired: 3 } });
    expect(run.startedAt).toBeInstanceOf(Date);
    expect(run.finishedAt).toBeInstanceOf(Date);
    expect(run.durationMs).toBeGreaterThanOrEqual(0);
    expect(fake.tables.cronLock).toHaveLength(0);
  });

  it("records a failure without throwing", async () => {
    const outcome = await runCronTask("notify-digest", async () => {
      throw new Error("db timeout");
    });
    expect(outcome).toMatchObject({ status: "FAILED", error: "db timeout" });
    expect(runs("notify-digest")[0]).toMatchObject({ status: "FAILED", error: "db timeout" });
    expect(fake.tables.cronLock).toHaveLength(0);
  });

  it("skips an overlapping execution of the same task", async () => {
    let finish!: () => void;
    const first = runCronTask("agent-schedule", () => new Promise<void>((r) => (finish = r)));
    await vi.waitFor(() => expect(runs("agent-schedule")).toHaveLength(1));

    const second = await runCronTask("agent-schedule", async () => "should not run");
    expect(second.status).toBe("SKIPPED");
    // A different task isn't blocked.
    expect((await runCronTask("jobs-expire", async () => null)).status).toBe("SUCCEEDED");

    finish();
    expect((await first).status).toBe("SUCCEEDED");
    expect(runs("agent-schedule").map((r: any) => r.status).sort()).toEqual(["SKIPPED", "SUCCEEDED"]);
  });

  it("takes over after a crashed execution and marks it interrupted", async () => {
    fake.tables.cronRun = [{ id: "dead", task: "jobs-expire", status: "RUNNING", attempt: 1, startedAt: new Date(Date.now() - CRON_LEASE_MS - 1000) }];
    fake.tables.cronLock = [{ task: "jobs-expire", runId: "dead", lockedUntil: new Date(Date.now() - 1000) }];

    const outcome = await runCronTask("jobs-expire", async () => "ok");
    expect(outcome.status).toBe("SUCCEEDED");
    expect(runs().find((r: any) => r.id === "dead")).toMatchObject({ status: "FAILED", error: expect.stringContaining("Interrupted") });
  });

  it("doesn't take over a lock that is still live", async () => {
    fake.tables.cronLock = [{ task: "jobs-expire", runId: "alive", lockedUntil: new Date(Date.now() + 60_000) }];
    expect((await runCronTask("jobs-expire", async () => "ok")).status).toBe("SKIPPED");
  });
});

describe("failed task pickup", () => {
  const ago = (ms: number) => new Date(Date.now() - ms);

  it("finds failed and interrupted daily tasks with attempts left", async () => {
    fake.tables.cronRun = [
      { id: "1", task: "jobs-expire", status: "FAILED", attempt: 1, startedAt: ago(36e5) },
      { id: "2", task: "notify-digest", status: "RUNNING", attempt: 1, startedAt: ago(CRON_LEASE_MS + 60_000) },
    ];
    expect(await findTasksToRetry()).toEqual([
      { task: "jobs-expire", attempt: 2 },
      { task: "notify-digest", attempt: 2 },
    ]);
  });

  it("ignores successes, exhausted tasks, old failures and skipped runs", async () => {
    fake.tables.cronRun = [
      { id: "1", task: "jobs-expire", status: "FAILED", attempt: MAX_TASK_ATTEMPTS, startedAt: ago(36e5) },
      { id: "2", task: "notify-digest", status: "FAILED", attempt: 1, startedAt: ago(30 * 36e5) },
      { id: "3", task: "notify-digest", status: "SKIPPED", attempt: 1, startedAt: ago(1000) },
    ];
    expect(await findTasksToRetry()).toEqual([]);
    fake.tables.cronRun.push({ id: "4", task: "jobs-expire", status: "SUCCEEDED", attempt: 1, startedAt: ago(1000) });
    expect(await findTasksToRetry()).toEqual([]);
  });

  it("re-runs a failed task as the next attempt", async () => {
    fake.tables.cronRun = [{ id: "1", task: "jobs-expire", status: "FAILED", attempt: 1, startedAt: ago(36e5) }];
    const { retried } = await retryFailedTasks(Date.now() + 250_000);
    expect(retried).toEqual([{ task: "jobs-expire", status: "SUCCEEDED", attempt: 2, error: undefined }]);
    expect(runTaskNow).toHaveBeenCalledWith("jobs:expire", expect.objectContaining({ deadline: expect.any(Number) }));
    expect(await findTasksToRetry()).toEqual([]);
  });
});
