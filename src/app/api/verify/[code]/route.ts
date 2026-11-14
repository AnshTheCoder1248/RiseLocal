import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { handler, json, notFound } from "@/lib/api";
import { publicName, verifyCertificateSignature } from "@/lib/certs/sign";

// GET /api/verify/:code — public verification; validity + minimal fields, no PII (CERT-7, CERT-15, CERT-16).
export const GET = handler(async (_req: NextRequest, ctx: RouteContext<"/api/verify/[code]">) => {
  const { code } = await ctx.params;
  const cert = await db.certificate.findUnique({
    where: { code: code.toUpperCase() },
    include: {
      student: { select: { displayName: true } },
      issuer: { select: { displayName: true, role: true, employerOrg: { select: { name: true, verified: true } } } },
    },
  });
  if (!cert || cert.visibility === "private") throw notFound("No certificate found with that code");

  const signatureValid = verifyCertificateSignature(cert);
  return json({
    code: cert.code,
    valid: cert.status === "active" && signatureValid,
    status: cert.status === "revoked" ? "REVOKED" : signatureValid ? "VALID" : "INVALID",
    revokedReason: cert.status === "revoked" ? cert.revokedReason : undefined,
    kind: cert.kind,
    student: publicName(cert.student.displayName),
    roleTitle: cert.roleTitle,
    category: cert.category,
    issuer: {
      name: cert.issuer.employerOrg?.name ?? publicName(cert.issuer.displayName),
      verified: !!cert.issuer.employerOrg?.verified,
      type: cert.issuer.role === "EMPLOYER" ? "business" : "community",
    },
    period: { start: cert.startDate, end: cert.endDate },
    totalHours: cert.totalHours,
    sessions: cert.sessions,
    skills: cert.skills,
    rating: cert.rating,
    issuedAt: cert.issuedAt,
    signatureValid,
  });
});
