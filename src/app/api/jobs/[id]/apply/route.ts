import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { handler, json, parseBody, notFound, forbidden, unprocessable } from "@/lib/api";
import { applySchema } from "@/lib/validation/applications";
import { requireUser } from "@/lib/auth/session";
import { publicJobWhere } from "@/lib/safety/gate";
import { checkContent } from "@/lib/safety/filter";
import { ageOn, needsGuardian } from "@/lib/auth/age";
import { createToken, days } from "@/lib/tokens";
import { emailGuardian, notify } from "@/lib/notifications";
import { kickOutbox } from "@/lib/outbox";
import { enforceRateLimit, LIMITS } from "@/lib/rate-limit";

// POST /api/jobs/:id/apply — profile + optional note; guardian gate for 13–15 (AP-2, SAFE-3).
export const POST = handler(async (req: NextRequest, ctx: RouteContext<"/api/jobs/[id]/apply">) => {
  const { id } = await ctx.params;
  const student = await requireUser({ roles: ["STUDENT"] });
  await enforceRateLimit(LIMITS.apply(student.id));
  const { note } = await parseBody(req, applySchema);

  const job = await db.job.findFirst({ where: { id, ...publicJobWhere() } });
  if (!job) throw notFound("This job isn't accepting applications");

  const age = student.dateOfBirth ? ageOn(student.dateOfBirth) : undefined;
  if (age == null) throw forbidden("Add your date of birth before applying");
  if (age < job.minAge) throw unprocessable(`This job is for ages ${job.minAge}+`, { reason: "too_young" });

  if (note) {
    const safety = checkContent({ description: note });
    if (safety.decision !== "pass") throw unprocessable("Please keep notes on RiseLocal — no phone numbers, emails, or social handles.", { flags: safety.flags });
  }

  const guardian = await db.guardian.findUnique({ where: { studentId: student.id } });
  const younger = needsGuardian(age);
  if (younger && !guardian?.consentAt) throw forbidden("Your guardian needs to approve your account first");
  const holdForGuardian = younger && !!guardian?.requireApproval;

  // The application and the guardian email commit together (transactional outbox), so a held
  // application can never be stuck without its approval link.
  const application = await db.$transaction(async (tx) => {
    const created = await tx.application.create({
      data: { jobId: id, studentId: student.id, note, status: holdForGuardian ? "PENDING_GUARDIAN" : "SENT" },
    });
    if (younger && guardian) {
      const link = holdForGuardian
        ? `\n\nApprove or decline: ${env().APP_URL}/guardian/approve?token=${createToken({ kind: "guardian-approve", applicationId: created.id, email: guardian.email, exp: days(7) })}`
        : "";
      await emailGuardian(
        guardian.email,
        holdForGuardian ? `Approve ${student.displayName}'s application?` : `${student.displayName} applied for a job`,
        `${student.displayName} applied to "${job.title}" (${job.areaLabel}) on RiseLocal.${note ? `\nTheir note: "${note}"` : ""}${link}`,
        { idempotencyKey: `guardian-application:${created.id}`, tx },
      );
    }
    return created;
  });
  if (younger && guardian) await kickOutbox();
  if (!holdForGuardian) {
    await notify(job.postedById, "app_update", { applicationId: application.id, jobId: job.id, title: job.title, status: "NEW_APPLICANT" });
  }

  return json({ application, guardianApprovalRequired: holdForGuardian }, 201);
});
