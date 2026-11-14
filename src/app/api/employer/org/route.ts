import { db } from "@/lib/db";
import { handler, json, parseBody } from "@/lib/api";
import { orgVerificationSchema } from "@/lib/validation/misc";
import { requireUser } from "@/lib/auth/session";

// GET /api/employer/org — the employer's business + locations.
export const GET = handler(async () => {
  const user = await requireUser({ roles: ["EMPLOYER"] });
  const org = user.orgId ? await db.employerOrg.findUnique({ where: { id: user.orgId }, include: { locations: true } }) : null;
  return json({ org });
});

// POST /api/employer/org — submit business details for verification (AUTH-5, MOD-3).
export const POST = handler(async (req: Request) => {
  const user = await requireUser({ roles: ["EMPLOYER"] });
  const input = await parseBody(req, orgVerificationSchema);
  const data = { ...input, verificationStatus: "PENDING" as const };
  const org = user.orgId
    ? await db.employerOrg.update({ where: { id: user.orgId }, data })
    : await db.employerOrg.create({ data: { ...data, members: { connect: { id: user.id } } } });
  return json({ org });
});
