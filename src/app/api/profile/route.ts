import { db } from "@/lib/db";
import { handler, json, parseBody } from "@/lib/api";
import { profileSchema } from "@/lib/validation/misc";
import { requireUser } from "@/lib/auth/session";
import { ageBand, ageOn } from "@/lib/auth/age";
import { coarsen } from "@/lib/geo";

// GET/PATCH /api/profile — the student's reusable application profile (AP-1).
export const GET = handler(async () => {
  const user = await requireUser({ roles: ["STUDENT"], allowPending: true });
  const [profile, guardian] = await Promise.all([
    db.studentProfile.findUnique({ where: { userId: user.id } }),
    db.guardian.findUnique({ where: { studentId: user.id }, select: { email: true, consentAt: true, requireApproval: true } }),
  ]);
  return json({
    user: { id: user.id, displayName: user.displayName, status: user.status, ageBand: user.dateOfBirth ? ageBand(ageOn(user.dateOfBirth)) : null },
    profile,
    guardian,
  });
});

export const PATCH = handler(async (req: Request) => {
  const user = await requireUser({ roles: ["STUDENT"], allowPending: true });
  const { lat, lng, ...input } = await parseBody(req, profileSchema);
  const data = { ...input, ...(lat !== undefined && { lat: coarsen(lat) }), ...(lng !== undefined && { lng: coarsen(lng) }) };
  const profile = await db.studentProfile.upsert({
    where: { userId: user.id },
    create: { userId: user.id, firstName: input.firstName ?? user.displayName.split(/\s+/)[0], availability: [], skills: [], ...data },
    update: data,
  });
  return json({ profile });
});
