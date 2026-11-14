import { db } from "@/lib/db";
import { handler, json, parseBody, notFound } from "@/lib/api";
import { createReportSchema } from "@/lib/validation/misc";
import { requireUser } from "@/lib/auth/session";
import { enforceRateLimit, LIMITS } from "@/lib/rate-limit";

const AUTO_HOLD_THRESHOLD = 2;

// POST /api/reports — report a job, gig, user, or certificate (SAFE-6).
export const POST = handler(async (req: Request) => {
  const user = await requireUser({ allowPending: true });
  await enforceRateLimit(LIMITS.report(user.id));
  const input = await parseBody(req, createReportSchema);

  const exists =
    input.targetType === "user"
      ? await db.user.count({ where: { id: input.targetId } })
      : input.targetType === "certificate"
        ? await db.certificate.count({ where: { id: input.targetId } })
        : await db.job.count({ where: { id: input.targetId } });
  if (!exists) throw notFound("Nothing to report there");

  const report = await db.report.create({ data: { ...input, reporterId: user.id } });

  // Repeated reports pull a listing off the board until a moderator decides (MOD-2).
  if (input.targetType === "job" || input.targetType === "gig") {
    const open = await db.report.count({ where: { targetId: input.targetId, status: "OPEN" } });
    if (open >= AUTO_HOLD_THRESHOLD || input.reason === "pii_solicitation") {
      await db.job.update({ where: { id: input.targetId }, data: { moderationHold: true } });
    }
  }
  return json({ report: { id: report.id, status: report.status } }, 201);
});
