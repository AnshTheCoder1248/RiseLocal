import { db } from "@/lib/db";
import { handler, json, parseBody, badRequest } from "@/lib/api";
import { guardianTokenSchema } from "@/lib/validation/auth";
import { verifyToken } from "@/lib/tokens";
import { audit } from "@/lib/audit";
import { clientIp, enforceRateLimit, LIMITS } from "@/lib/rate-limit";

// POST /api/guardian/consent — confirm consent via signed link; activates a 13–15 account.
export const POST = handler(async (req: Request) => {
  await enforceRateLimit(LIMITS.guardian(clientIp(req)));
  const { token } = await parseBody(req, guardianTokenSchema);
  const payload = verifyToken(token, "guardian-consent");
  if (!payload) throw badRequest("This link is invalid or has expired. Ask your teen to resend it.");

  const guardian = await db.guardian.findUnique({ where: { studentId: payload.studentId }, include: { student: true } });
  if (!guardian || guardian.email !== payload.email) throw badRequest("This link no longer matches the account.");

  await db.$transaction([
    db.guardian.update({ where: { id: guardian.id }, data: { consentAt: guardian.consentAt ?? new Date() } }),
    db.user.update({
      where: { id: guardian.studentId },
      data: { status: guardian.student.status === "PENDING" ? "ACTIVE" : guardian.student.status },
    }),
  ]);
  await audit(null, "guardian.consent", "user", guardian.studentId, { guardianEmail: guardian.email });
  return json({ ok: true, student: { displayName: guardian.student.displayName } });
});
