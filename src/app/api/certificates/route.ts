import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { handler, json } from "@/lib/api";
import { requireUser } from "@/lib/auth/session";

// GET /api/certificates — the student's experience wallet + totals (CERT-8).
export const GET = handler(async () => {
  const user = await requireUser({ roles: ["STUDENT"], allowPending: true });
  const certs = await db.certificate.findMany({
    where: { studentId: user.id },
    orderBy: { issuedAt: "desc" },
    include: { issuer: { select: { displayName: true, employerOrg: { select: { name: true, verified: true } } } } },
  });
  const active = certs.filter((c) => c.status === "active");
  const sum = (kind?: string) => active.filter((c) => !kind || c.kind === kind).reduce((s, c) => s + (c.totalHours ?? 0), 0);
  return json({
    items: certs.map(({ signature: _s, ...c }) => ({ ...c, verifyUrl: `${env().APP_URL}/verify/${c.code}` })),
    totals: { certificates: active.length, verifiedHours: sum(), workHours: sum("work"), volunteerHours: sum("volunteer") },
  });
});
