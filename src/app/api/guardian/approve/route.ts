import { db } from "@/lib/db";
import { handler, json, parseBody, badRequest } from "@/lib/api";
import { z } from "zod";
import { verifyToken } from "@/lib/tokens";
import { notify } from "@/lib/notifications";
import { audit } from "@/lib/audit";
import { clientIp, enforceRateLimit, LIMITS } from "@/lib/rate-limit";

const schema = z.object({ token: z.string().min(10).max(2000), decision: z.enum(["approve", "decline"]) });

// POST /api/guardian/approve — guardian approves/declines a held application (SAFE-3, AP-2).
export const POST = handler(async (req: Request) => {
  await enforceRateLimit(LIMITS.guardian(clientIp(req)));
  const { token, decision } = await parseBody(req, schema);
  const payload = verifyToken(token, "guardian-approve");
  if (!payload) throw badRequest("This link is invalid or has expired.");

  const app = await db.application.findUnique({
    where: { id: payload.applicationId },
    include: { job: { select: { id: true, title: true, postedById: true } }, student: { include: { guardian: true } } },
  });
  if (!app || app.student.guardian?.email !== payload.email) throw badRequest("This link no longer matches the application.");
  if (app.status !== "PENDING_GUARDIAN") return json({ ok: true, status: app.status });

  const updated = await db.application.update({
    where: { id: app.id },
    data: decision === "approve" ? { status: "SENT", guardianApprovedAt: new Date() } : { status: "WITHDRAWN" },
  });
  await audit(null, `guardian.application.${decision}`, "application", app.id, { guardianEmail: payload.email });
  await notify(app.studentId, "app_update", { applicationId: app.id, jobId: app.job.id, title: app.job.title, status: decision === "approve" ? "GUARDIAN_APPROVED" : "GUARDIAN_DECLINED" });
  if (decision === "approve") {
    await notify(app.job.postedById, "app_update", { applicationId: app.id, jobId: app.job.id, title: app.job.title, status: "NEW_APPLICANT" });
  }
  return json({ ok: true, status: updated.status });
});
