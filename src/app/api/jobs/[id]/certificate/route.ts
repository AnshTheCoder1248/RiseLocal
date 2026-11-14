import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { handler, json, parseBody, forbidden, unprocessable, conflict, ApiError } from "@/lib/api";
import { issueCertificateSchema } from "@/lib/validation/misc";
import { requireUser } from "@/lib/auth/session";
import { loadManagedJob } from "@/lib/jobs/service";
import { generateCertCode, signCertificate } from "@/lib/certs/sign";
import { ageOn, needsGuardian } from "@/lib/auth/age";
import { audit } from "@/lib/audit";
import { emailGuardian, notify } from "@/lib/notifications";

const MAX_CERTS_PER_ISSUER_PER_DAY = 20;

// POST /api/jobs/:id/certificate — issue a work/volunteer certificate (CERT-1..6, CERT-11, CERT-12).
export const POST = handler(async (req: NextRequest, ctx: RouteContext<"/api/jobs/[id]/certificate">) => {
  const { id } = await ctx.params;
  const issuer = await requireUser({ roles: ["EMPLOYER", "COMMUNITY"] });
  const job = await loadManagedJob(id, issuer);
  const input = await parseBody(req, issueCertificateSchema);

  // CERT-11: only verified employers or established community posters may issue.
  if (issuer.role === "EMPLOYER") {
    const org = issuer.orgId ? await db.employerOrg.findUnique({ where: { id: issuer.orgId } }) : null;
    if (!org?.verified) throw forbidden("Only verified businesses can issue certificates");
  } else {
    const ratedCompletions = await db.application.count({
      where: { job: { postedById: issuer.id }, studentConfirmedAt: { not: null }, posterConfirmedAt: { not: null }, posterRating: { not: null }, jobId: { not: id } },
    });
    if (ratedCompletions === 0) throw forbidden("Complete and get rated on a prior gig before issuing certificates");
  }

  // CERT-1: completed and mutually confirmed engagement logged on RiseLocal.
  const app = await db.application.findUnique({ where: { jobId_studentId: { jobId: id, studentId: input.studentId } }, include: { student: { include: { guardian: true } } } });
  if (!app || app.status !== "HIRED" || !app.studentConfirmedAt || !app.posterConfirmedAt) {
    throw unprocessable("Both you and the student must confirm this work is complete before issuing a certificate");
  }

  // CERT-12: sanity limits.
  if (input.totalHours != null && app.hoursLogged != null && input.totalHours > app.hoursLogged) {
    throw unprocessable(`Certified hours can't exceed the ${app.hoursLogged} hours logged`);
  }
  const start = new Date(input.startDate);
  const end = new Date(input.endDate);
  if (end < start) throw unprocessable("End date must be after start date");
  const today = await db.certificate.count({ where: { issuerId: issuer.id, issuedAt: { gte: new Date(Date.now() - 864e5) } } });
  if (today >= MAX_CERTS_PER_ISSUER_PER_DAY) throw new ApiError(429, "Daily certificate limit reached");
  if (await db.certificate.count({ where: { jobId: id, studentId: input.studentId } })) throw conflict("A certificate was already issued for this engagement");

  const base = {
    code: generateCertCode(),
    kind: job.payType === "VOLUNTEER" ? "volunteer" : "work",
    jobId: id,
    studentId: input.studentId,
    issuerId: issuer.id,
    roleTitle: input.roleTitle ?? job.title,
    startDate: start,
    endDate: end,
    totalHours: input.totalHours ?? app.hoursLogged ?? null,
  };
  const cert = await db.certificate.create({
    data: {
      ...base,
      category: job.category,
      sessions: input.sessions,
      skills: input.skills,
      note: input.note,
      rating: input.rating,
      signature: signCertificate(base),
    },
  });

  // CERT-4: explicit attestation in the audit log.
  await audit(issuer.id, "cert.issue", "certificate", cert.id, { attestation: "I confirm this student completed this work", jobId: id, studentId: input.studentId });

  const verifyUrl = `${env().APP_URL}/verify/${cert.code}`;
  await notify(input.studentId, "system", { type: "certificate_issued", certificateId: cert.id, code: cert.code, roleTitle: cert.roleTitle });
  // CERT-6: guardian of a 13–15 student is notified.
  const age = app.student.dateOfBirth ? ageOn(app.student.dateOfBirth) : 99;
  if (needsGuardian(age) && app.student.guardian?.consentAt) {
    await emailGuardian(app.student.guardian.email, `${app.student.displayName} earned a certificate`, `${app.student.displayName} received a ${cert.kind === "volunteer" ? "Volunteer Service" : "Work Experience"} certificate for "${cert.roleTitle}".\nView it: ${verifyUrl}`, { idempotencyKey: `guardian-certificate:${cert.id}` });
  }

  return json({ certificate: cert, verifyUrl }, 201);
});
