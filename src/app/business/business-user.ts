import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";

/** The signed-in business user and their organization; anyone else is sent elsewhere. */
export async function requireBusiness(next: string) {
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(next)}`);
  if (user.role !== "EMPLOYER") redirect(user.role === "ADMIN" ? "/review" : "/jobs");
  const org = user.orgId
    ? await db.employerOrg.findUnique({ where: { id: user.orgId }, select: { id: true, name: true, verified: true } })
    : null;
  return { user, org };
}

/** Jobs that belong to this business: posted by its org or by this user. */
export const businessJobsWhere = (userId: string, orgId: string | null | undefined) => ({
  OR: [{ postedById: userId }, ...(orgId ? [{ orgId }] : [])],
});
