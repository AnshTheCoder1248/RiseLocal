import { db } from "./db";
import { enqueueEmail, kickOutbox } from "./outbox";
import { Prisma } from "@/generated/prisma/client";

type NotifyOptions = {
  dedupeKey?: string;
  /** Also email the user. Queued in the same transaction as the in-app notification. */
  email?: { subject: string; text: string; idempotencyKey?: string };
};

const isUniqueViolation = (err: unknown) => err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";

export async function notify(userId: string, kind: string, payload: Prisma.InputJsonValue, opts: NotifyOptions = {}) {
  let notification;
  try {
    notification = await db.$transaction(async (tx) => {
      if (opts.dedupeKey) {
        const exists = await tx.notification.findUnique({ where: { dedupeKey: opts.dedupeKey }, select: { id: true } });
        if (exists) return null;
      }
      const created = await tx.notification.create({ data: { userId, kind, payload, dedupeKey: opts.dedupeKey } });
      if (opts.email) {
        const user = await tx.user.findUnique({ where: { id: userId }, select: { email: true } });
        if (user) {
          const idempotencyKey = opts.email.idempotencyKey ?? `notification:${created.id}`;
          await enqueueEmail({ to: user.email, subject: opts.email.subject, text: opts.email.text, idempotencyKey }, tx);
        }
      }
      return created;
    });
  } catch (err) {
    if (opts.dedupeKey && isUniqueViolation(err)) return null; // a concurrent call won the dedupe race
    throw err;
  }
  if (notification && opts.email) await kickOutbox();
  return notification;
}

type GuardianEmailOptions = {
  idempotencyKey: string;
  /** Enqueue inside this transaction. The caller must call kickOutbox() after it commits. */
  tx?: Prisma.TransactionClient;
};

export async function emailGuardian(to: string, subject: string, text: string, { idempotencyKey, tx }: GuardianEmailOptions) {
  await enqueueEmail({ to, subject, text, idempotencyKey }, tx ?? db);
  if (!tx) await kickOutbox();
}
