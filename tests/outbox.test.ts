/* eslint-disable @typescript-eslint/no-explicit-any -- tests drive the untyped in-memory Prisma fake */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", async () => ({ db: (await import("./helpers/fake-db")).createFakeDb() }));
vi.mock("@/lib/tasks", () => ({ runTask: vi.fn(), runTaskNow: vi.fn() }));

import { db } from "@/lib/db";
import { runTask } from "@/lib/tasks";
import { EmailSendError, type EmailSender } from "@/lib/email";
import { claimOutboxBatch, deliverOutbox, enqueueEmail, OUTBOX, recoverStaleOutbox } from "@/lib/outbox";
import { emailGuardian, notify } from "@/lib/notifications";
import { backoffMs } from "@/lib/backoff";

const fake = db as any;
const rows = () => fake.tables.emailOutbox ?? [];
const email = (key = "k1") => ({ to: "guardian@example.com", subject: "Hi", text: "Body", idempotencyKey: key });
const mid = () => 0.5; // jitter factor 1.0, so backoff is exact

let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  for (const k of Object.keys(fake.tables)) delete fake.tables[k];
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("backoff", () => {
  it("doubles per attempt and caps", () => {
    expect([1, 2, 3, 4].map((a) => backoffMs(a, { baseMs: 1000, random: mid }))).toEqual([1000, 2000, 4000, 8000]);
    expect(backoffMs(30, { baseMs: 1000, maxMs: 5000, random: mid })).toBe(5000);
  });
  it("jitters within ±20%", () => {
    expect(backoffMs(1, { baseMs: 1000, random: () => 0 })).toBe(800);
    expect(backoffMs(1, { baseMs: 1000, random: () => 1 })).toBe(1200);
  });
});

describe("email outbox: duplicate prevention", () => {
  it("ignores a second enqueue with the same idempotency key", async () => {
    expect(await enqueueEmail(email("guardian-consent:u1"))).toEqual({ enqueued: true });
    expect(await enqueueEmail(email("guardian-consent:u1"))).toEqual({ enqueued: false });
    expect(rows()).toHaveLength(1);
  });

  it("never hands the same row to two concurrent senders", async () => {
    for (let i = 0; i < 5; i++) await enqueueEmail(email(`k${i}`));
    const now = new Date();
    const [a, b] = await Promise.all([claimOutboxBatch("worker-a", 3, now), claimOutboxBatch("worker-b", 3, now)]);
    const ids = [...a, ...b].map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(5);
  });

  it("sends with a per-row provider idempotency key", async () => {
    await enqueueEmail(email());
    const send = vi.fn<EmailSender>().mockResolvedValue({ id: "re_123" });
    const stats = await deliverOutbox({ send });
    expect(stats.sent).toBe(1);
    expect(send).toHaveBeenCalledWith({ to: "guardian@example.com", subject: "Hi", text: "Body" }, { idempotencyKey: `outbox-${rows()[0].id}` });
    expect(rows()[0]).toMatchObject({ status: "SENT", providerMessageId: "re_123", lockedBy: null, attempts: 1 });
    // Delivering again doesn't resend.
    await deliverOutbox({ send });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("dedupes notify() emails through the notification dedupeKey", async () => {
    fake.tables.user = [{ id: "u1", email: "teen@example.com" }];
    const first = await notify("u1", "watch_match", { jobId: "j1" }, { dedupeKey: "watch:w1:j1", email: { subject: "New match", text: "…" } });
    const second = await notify("u1", "watch_match", { jobId: "j1" }, { dedupeKey: "watch:w1:j1", email: { subject: "New match", text: "…" } });
    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ to: "teen@example.com", idempotencyKey: `notification:${first!.id}` });
    expect(runTask).toHaveBeenCalledTimes(1); // delivery kicked once, after commit
  });

  it("emailGuardian inside a transaction rolls back with it", async () => {
    await expect(
      fake.$transaction(async (tx: any) => {
        await emailGuardian("g@example.com", "Approve?", "…", { idempotencyKey: "guardian-application:a1", tx });
        throw new Error("application insert failed");
      }),
    ).rejects.toThrow();
    expect(rows()).toHaveLength(0);
    expect(runTask).not.toHaveBeenCalled();
  });
});

describe("email outbox: retries", () => {
  it("retries with exponential backoff, then fails permanently after 5 attempts and logs it", async () => {
    await enqueueEmail(email());
    const send = vi.fn<EmailSender>().mockRejectedValue(new EmailSendError("Email send failed: 503", true));
    let clock = Date.now();
    const now = () => new Date(clock);

    const delays: number[] = [];
    for (let attempt = 1; attempt <= OUTBOX.maxAttempts; attempt++) {
      const stats = await deliverOutbox({ send, now, random: mid });
      const row = rows()[0];
      expect(row.attempts).toBe(attempt);
      if (attempt < OUTBOX.maxAttempts) {
        expect(stats.retrying).toBe(1);
        expect(row.status).toBe("PENDING");
        delays.push(row.nextAttemptAt.getTime() - clock);
        // Not due yet: a run before nextAttemptAt doesn't send.
        await deliverOutbox({ send, now, random: mid });
        expect(send).toHaveBeenCalledTimes(attempt);
        clock = row.nextAttemptAt.getTime();
      } else {
        expect(stats.failed).toBe(1);
        expect(row.status).toBe("FAILED");
        expect(row.lastError).toContain("503");
      }
    }
    expect(delays).toEqual([60_000, 120_000, 240_000, 480_000]);
    expect(errorSpy).toHaveBeenCalledWith("[email:failed]", expect.stringContaining('"reason":"max_attempts"'));
    // The log masks the address.
    expect(errorSpy.mock.calls[0][1]).toContain("g***@example.com");

    // A failed row is never retried.
    clock += 24 * 36e5;
    await deliverOutbox({ send, now });
    expect(send).toHaveBeenCalledTimes(OUTBOX.maxAttempts);
  });

  it("fails immediately on a non-retryable error", async () => {
    await enqueueEmail(email());
    const send = vi.fn<EmailSender>().mockRejectedValue(new EmailSendError("Email send failed: 422 invalid to", false));
    const stats = await deliverOutbox({ send });
    expect(stats.failed).toBe(1);
    expect(rows()[0]).toMatchObject({ status: "FAILED", attempts: 1 });
    expect(errorSpy).toHaveBeenCalledWith("[email:failed]", expect.stringContaining("non_retryable"));
  });

  it("succeeds on a later attempt", async () => {
    await enqueueEmail(email());
    const send = vi.fn<EmailSender>().mockRejectedValueOnce(new Error("socket hang up")).mockResolvedValue({ id: "re_1" });
    let clock = Date.now();
    await deliverOutbox({ send, now: () => new Date(clock) });
    clock = rows()[0].nextAttemptAt.getTime();
    await deliverOutbox({ send, now: () => new Date(clock) });
    expect(rows()[0]).toMatchObject({ status: "SENT", attempts: 2, lastError: null });
  });
});

describe("email outbox: interrupted executions", () => {
  it("recovers rows left PROCESSING past the lease and sends them", async () => {
    await enqueueEmail(email());
    rows()[0].nextAttemptAt = new Date(0);
    await claimOutboxBatch("dead-worker", 10, new Date(Date.now() - OUTBOX.leaseMs - 1000));
    expect(rows()[0].status).toBe("PROCESSING");

    const send = vi.fn<EmailSender>().mockResolvedValue({ id: "re_9" });
    const stats = await deliverOutbox({ send });
    expect(stats).toMatchObject({ recovered: 1, sent: 1 });
    expect(rows()[0]).toMatchObject({ status: "SENT", attempts: 2 });
  });

  it("leaves rows alone while their lease is live", async () => {
    await enqueueEmail(email());
    await claimOutboxBatch("live-worker", 10, new Date());
    expect(await recoverStaleOutbox()).toEqual({ recovered: 0, failed: 0 });
    expect(rows()[0]).toMatchObject({ status: "PROCESSING", lockedBy: "live-worker" });
  });

  it("marks a row FAILED if it was interrupted during its final attempt", async () => {
    await enqueueEmail(email());
    rows()[0].attempts = OUTBOX.maxAttempts - 1;
    rows()[0].nextAttemptAt = new Date(0);
    await claimOutboxBatch("dead-worker", 10, new Date(Date.now() - OUTBOX.leaseMs - 1000));
    expect(await recoverStaleOutbox()).toEqual({ recovered: 0, failed: 1 });
    expect(rows()[0].status).toBe("FAILED");
    expect(errorSpy).toHaveBeenCalledWith("[email:failed]", expect.stringContaining("interrupted"));
  });

  it("a sender that lost its lease can't overwrite the row", async () => {
    await enqueueEmail(email());
    const send: EmailSender = async () => {
      // While this send is in flight, recovery hands the row to another worker.
      rows()[0].lockedBy = "other-worker";
      throw new Error("timeout");
    };
    await deliverOutbox({ send });
    expect(rows()[0]).toMatchObject({ status: "PROCESSING", lockedBy: "other-worker" });
  });
});
