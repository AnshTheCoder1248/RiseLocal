import { db } from "@/lib/db";
import { checkContent, type SafetyResult } from "./filter";
import type { Job, User } from "@/generated/prisma/client";

// The three-part safety gate (spec §03): a job is visible to students only after
// (1) content + teen-suitability filter, (2) poster identity check, (3) no moderation hold.

export const MAX_OPEN_GIGS_NEW_POSTER = 3;

export type GateResult =
  | { ok: true; safety: SafetyResult }
  | { ok: false; reason: "rejected" | "held" | "poster_not_allowed" | "rate_limited"; message: string; safety?: SafetyResult };

export async function runPublishGate(
  job: Pick<Job, "id" | "title" | "description" | "tags" | "source">,
  poster: Pick<User, "id" | "role" | "status">,
): Promise<GateResult> {
  const safety = checkContent(job);
  if (safety.decision === "reject") {
    return { ok: false, reason: "rejected", safety, message: `This post can't be listed for teens (${safety.flags.join(", ")}).` };
  }
  if (safety.decision === "hold") {
    return { ok: false, reason: "held", safety, message: "Your post is being reviewed by our safety team before it goes live." };
  }

  if (poster.status !== "ACTIVE" && poster.role !== "ADMIN") {
    return { ok: false, reason: "poster_not_allowed", message: "Your account must be active to publish." };
  }

  // Community posters are throttled until established (GIG-6).
  if (poster.role === "COMMUNITY") {
    const [open, completed] = await Promise.all([
      db.job.count({ where: { postedById: poster.id, status: "PUBLISHED", id: { not: job.id } } }),
      db.application.count({ where: { job: { postedById: poster.id }, posterConfirmedAt: { not: null }, studentConfirmedAt: { not: null } } }),
    ]);
    if (completed === 0 && open >= MAX_OPEN_GIGS_NEW_POSTER) {
      return { ok: false, reason: "rate_limited", message: `New posters can have up to ${MAX_OPEN_GIGS_NEW_POSTER} open gigs at once.` };
    }
  }

  return { ok: true, safety };
}

/** Where-clause fragment for anything a student may see on the board. */
export function publicJobWhere(now = new Date()) {
  return {
    status: "PUBLISHED" as const,
    moderationHold: false,
    archivedAt: null,
    OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
  };
}
