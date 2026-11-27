import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";

/** Who manages postings: businesses (jobs, with Scout) or community members (gigs). */
export type PosterKind = "business" | "community";

/** Where each kind of poster's pages live, and what they call a posting. Applicants and the stats dashboard are business-only. */
export const POSTER = {
  business: { role: "EMPLOYER", home: "/business", applicants: "/business/applicants", post: "/business/post", noun: "job" },
  community: { role: "COMMUNITY", home: "/my-jobs", post: "/post", noun: "gig" },
} as const;

/** The signed-in poster of this kind (and their business, if any); anyone else is sent elsewhere. */
export async function requirePoster(kind: PosterKind, next: string) {
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(next)}`);
  if (user.role !== POSTER[kind].role) {
    redirect(user.role === "ADMIN" ? "/review" : user.role === "EMPLOYER" ? POSTER.business.home : user.role === "COMMUNITY" ? POSTER.community.home : "/jobs");
  }
  const org = kind === "business" && user.orgId
    ? await db.employerOrg.findUnique({ where: { id: user.orgId }, select: { id: true, name: true, verified: true } })
    : null;
  return { user, org };
}

/** The signed-in business user and their organization; anyone else is sent elsewhere. */
export const requireBusiness = (next: string) => requirePoster("business", next);

/** Jobs that belong to this business: posted by its org or by this user. */
export const businessJobsWhere = (userId: string, orgId: string | null | undefined) => ({
  OR: [{ postedById: userId }, ...(orgId ? [{ orgId }] : [])],
});
