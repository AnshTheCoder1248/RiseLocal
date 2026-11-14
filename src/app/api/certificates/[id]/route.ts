import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { handler, json, parseBody, notFound, forbidden, conflict } from "@/lib/api";
import { updateCertificateSchema } from "@/lib/validation/misc";
import { requireUser } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notifications";

// PATCH /api/certificates/:id — student changes visibility; issuer/admin revokes with reason (CERT-9, CERT-13).
export const PATCH = handler(async (req: NextRequest, ctx: RouteContext<"/api/certificates/[id]">) => {
  const { id } = await ctx.params;
  const user = await requireUser({ allowPending: true });
  const input = await parseBody(req, updateCertificateSchema);
  const cert = await db.certificate.findUnique({ where: { id } });
  if (!cert) throw notFound("Certificate not found");

  if ("visibility" in input) {
    if (cert.studentId !== user.id) throw forbidden("Only the student controls visibility");
    const updated = await db.certificate.update({ where: { id }, data: { visibility: input.visibility } });
    return json({ certificate: { id: updated.id, visibility: updated.visibility } });
  }

  if (cert.issuerId !== user.id && user.role !== "ADMIN") throw forbidden("Only the issuer or an admin can revoke");
  if (user.status !== "ACTIVE") throw forbidden("Your account is not active");
  if (cert.status === "revoked") throw conflict("Already revoked");
  const updated = await db.certificate.update({ where: { id }, data: { status: "revoked", revokedReason: input.reason } });
  await audit(user.id, "cert.revoke", "certificate", id, { reason: input.reason });
  await notify(cert.studentId, "system", { type: "certificate_revoked", certificateId: id, reason: input.reason });
  return json({ certificate: { id: updated.id, status: updated.status, revokedReason: updated.revokedReason } });
});
