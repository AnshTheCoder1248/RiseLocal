import { randomUUID } from "node:crypto";
import { db } from "./db";
import { EmailSendError, sendEmail, type Email, type EmailSender } from "./email";
import { backoffMs, errorText } from "./backoff";
import type { Prisma } from "@/generated/prisma/client";

// Transactional email outbox (Postgres only, no queue).
//
// 1. enqueueEmail() inserts an EmailOutbox row, ideally in the same transaction as the change
//    that triggers it, so an email is never lost or sent for a rolled-back change.
// 2. deliverOutbox() claims due rows with FOR UPDATE SKIP LOCKED (concurrent senders never get
//    the same row), sends them, and marks each SENT, or reschedules it with exponential backoff.
//    After OUTBOX.maxAttempts, or on a non-retryable error, the row becomes FAILED and is logged.
// 3. Rows left PROCESSING by an interrupted execution are recovered once their lease expires.
//    The resend is safe because the provider gets an idempotency key per row.
//
// Delivery runs right after the request (kickOutbox → after()) and every few minutes from
// Vercel Cron (/api/cron/email-outbox), which handles retries and recovery.

export const OUTBOX = {
  maxAttempts: 5,
  /** Longer than any function's maxDuration (300s), so a live sender never loses its rows. */
  leaseMs: 10 * 60_000,
  batchSize: 10,
  baseBackoffMs: 60_000, // 1m, 2m, 4m, 8m between the 5 attempts (±20%)
  maxBackoffMs: 60 * 60_000,
};

type Client = typeof db | Prisma.TransactionClient;

export type OutboxEmail = Email & {
  /** Stable key for this logical email, e.g. `guardian-consent:<userId>`. Re-enqueueing it is a no-op. */
  idempotencyKey: string;
};

/** Persist an email for delivery. Pass a transaction client to tie it to the surrounding write. */
export async function enqueueEmail(email: OutboxEmail, client: Client = db) {
  const { count } = await client.emailOutbox.createMany({
    data: [{ idempotencyKey: email.idempotencyKey, to: email.to, subject: email.subject, text: email.text, maxAttempts: OUTBOX.maxAttempts }],
    skipDuplicates: true,
  });
  return { enqueued: count === 1 };
}

/**
 * Start delivering right after the current response. Call it after the transaction that enqueued
 * the email has committed. If it never runs, the email-outbox cron delivers the email later.
 */
export async function kickOutbox() {
  const { runTask } = await import("./tasks");
  await runTask("email:deliver", { budgetMs: 20_000 });
}

type ClaimedRow = { id: string; idempotencyKey: string; to: string; subject: string; text: string; attempts: number; maxAttempts: number };

/** Atomically claim up to `limit` due rows for this worker and count the attempt. */
export async function claimOutboxBatch(workerId: string, limit: number, now: Date): Promise<ClaimedRow[]> {
  return db.$queryRaw<ClaimedRow[]>`
    UPDATE "EmailOutbox"
    SET "status" = 'PROCESSING', "lockedBy" = ${workerId}, "lockedAt" = ${now}, "attempts" = "attempts" + 1, "updatedAt" = ${now}
    WHERE "id" IN (
      SELECT "id" FROM "EmailOutbox"
      WHERE "status" = 'PENDING' AND "nextAttemptAt" <= ${now}
      ORDER BY "nextAttemptAt"
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING "id", "idempotencyKey", "to", "subject", "text", "attempts", "maxAttempts"`;
}

const maskEmail = (to: string) => to.replace(/^(.).*(@.*)$/, "$1***$2");

function logPermanentFailure(row: Pick<ClaimedRow, "id" | "idempotencyKey" | "to" | "attempts">, reason: string, error: string) {
  console.error(
    "[email:failed]",
    JSON.stringify({ outboxId: row.id, idempotencyKey: row.idempotencyKey, to: maskEmail(row.to), attempts: row.attempts, reason, error }),
  );
}

/**
 * Reset rows whose sender died mid-delivery (PROCESSING past the lease). Rows that already used
 * their last attempt become FAILED. The rest go back to PENDING for an immediate retry.
 */
export async function recoverStaleOutbox(now = new Date()) {
  const cutoff = new Date(now.getTime() - OUTBOX.leaseMs);
  const stale = { status: "PROCESSING" as const, lockedAt: { lt: cutoff } };

  const exhausted = await db.emailOutbox.findMany({
    where: { ...stale, attempts: { gte: db.emailOutbox.fields.maxAttempts } },
    select: { id: true, idempotencyKey: true, to: true, attempts: true },
  });
  let failed = 0;
  if (exhausted.length) {
    const error = "Interrupted during the final attempt";
    ({ count: failed } = await db.emailOutbox.updateMany({
      where: { ...stale, id: { in: exhausted.map((r) => r.id) } },
      data: { status: "FAILED", lockedBy: null, lockedAt: null, lastError: error },
    }));
    for (const row of exhausted) logPermanentFailure(row, "interrupted", error);
  }
  const { count: recovered } = await db.emailOutbox.updateMany({
    where: stale,
    data: { status: "PENDING", lockedBy: null, lockedAt: null, nextAttemptAt: now, lastError: "Recovered after an interrupted delivery" },
  });
  return { recovered, failed };
}

type DeliverOptions = {
  /** Epoch ms after which no new sends start. */
  deadline?: number;
  send?: EmailSender;
  now?: () => Date;
  batchSize?: number;
  random?: () => number;
};

export async function deliverOutbox({ deadline = Date.now() + 20_000, send = sendEmail, now = () => new Date(), batchSize = OUTBOX.batchSize, random }: DeliverOptions = {}) {
  const workerId = randomUUID();
  const stats = { sent: 0, retrying: 0, failed: 0, recovered: 0 };
  const recovery = await recoverStaleOutbox(now());
  stats.recovered = recovery.recovered;
  stats.failed += recovery.failed;

  while (Date.now() < deadline) {
    const batch = await claimOutboxBatch(workerId, batchSize, now());
    if (!batch.length) break;
    for (const row of batch) {
      if (Date.now() >= deadline) {
        // Out of time. Hand the row back untouched and refund the attempt.
        await db.emailOutbox.updateMany({
          where: { id: row.id, lockedBy: workerId },
          data: { status: "PENDING", lockedBy: null, lockedAt: null, attempts: { decrement: 1 } },
        });
        continue;
      }
      stats[await deliverOne(row, workerId, send, now, random)]++;
    }
  }
  return stats;
}

async function deliverOne(row: ClaimedRow, workerId: string, send: EmailSender, now: () => Date, random?: () => number) {
  // Every write is guarded by lockedBy, so a sender that lost its lease can't overwrite the row.
  const mine = { id: row.id, lockedBy: workerId };
  try {
    const { id } = await send({ to: row.to, subject: row.subject, text: row.text }, { idempotencyKey: `outbox-${row.id}` });
    await db.emailOutbox.updateMany({
      where: mine,
      data: { status: "SENT", sentAt: now(), providerMessageId: id, lockedBy: null, lockedAt: null, lastError: null },
    });
    return "sent" as const;
  } catch (err) {
    const error = errorText(err);
    const retryable = !(err instanceof EmailSendError) || err.retryable;
    if (!retryable || row.attempts >= row.maxAttempts) {
      await db.emailOutbox.updateMany({ where: mine, data: { status: "FAILED", lockedBy: null, lockedAt: null, lastError: error } });
      logPermanentFailure(row, retryable ? "max_attempts" : "non_retryable", error);
      return "failed" as const;
    }
    const delay = backoffMs(row.attempts, { baseMs: OUTBOX.baseBackoffMs, maxMs: OUTBOX.maxBackoffMs, random });
    await db.emailOutbox.updateMany({
      where: mine,
      data: { status: "PENDING", lockedBy: null, lockedAt: null, lastError: error, nextAttemptAt: new Date(now().getTime() + delay) },
    });
    console.warn(`[email:retry] outbox=${row.id} attempt=${row.attempts}/${row.maxAttempts} in ${Math.round(delay / 1000)}s: ${error}`);
    return "retrying" as const;
  }
}
