import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { handler, json, parseBody, notFound, badRequest, conflict } from "@/lib/api";
import { updateJobSchema } from "@/lib/validation/jobs";
import { getCurrentUser, requireUser } from "@/lib/auth/session";
import { canManageJob, loadManagedJob, notifyOpenApplicants, publishJob } from "@/lib/jobs/service";
import { publicJobSelect, withEligibility } from "@/lib/jobs/search";
import { publicJobWhere } from "@/lib/safety/gate";
import { checkContent } from "@/lib/safety/filter";
import { ageOn } from "@/lib/auth/age";
import { coarsen } from "@/lib/geo";
import { audit } from "@/lib/audit";
import { checkRateLimit, clientIp, LIMITS } from "@/lib/rate-limit";
import type { Prisma } from "@/generated/prisma/client";

// GET /api/jobs/:id — detail incl. poster trust signals. Non-public jobs only for their managers.
export const GET = handler(async (_req: NextRequest, ctx: RouteContext<"/api/jobs/[id]">) => {
  const { id } = await ctx.params;
  const viewer = await getCurrentUser();
  const job = await db.job.findUnique({ where: { id }, select: { ...publicJobSelect, postedById: true, orgId: true, moderationHold: true, archivedAt: true } });
  if (!job) throw notFound("Job not found");

  const isPublic = await db.job.count({ where: { id, ...publicJobWhere() } });
  const manager = viewer && canManageJob(job, viewer);
  if (!isPublic && !manager) throw notFound("Job not found");

  // Same rule as POST /api/jobs/:id/view: one counted view per viewer per job every 6 hours.
  if (isPublic && !manager) {
    const { allowed } = await checkRateLimit(LIMITS.jobView(viewer ? `user:${viewer.id}` : `ip:${clientIp(_req)}`, id));
    if (allowed) await db.job.update({ where: { id }, data: { views: { increment: 1 } } });
  }

  const [postsCount, hires, ratings] = await Promise.all([
    db.job.count({ where: { postedById: job.postedById, status: { in: ["PUBLISHED", "FILLED", "EXPIRED"] } } }),
    db.application.count({ where: { job: { postedById: job.postedById }, status: "HIRED" } }),
    db.application.aggregate({ where: { job: { postedById: job.postedById }, posterRating: { not: null } }, _avg: { posterRating: true }, _count: { posterRating: true } }),
  ]);

  const age = viewer?.role === "STUDENT" && viewer.dateOfBirth ? ageOn(viewer.dateOfBirth) : undefined;
  const [withHints] = withEligibility([job], age);
  const { postedById: _p, orgId: _o, ...rest } = withHints;
  return json({
    job: rest,
    trust: {
      verifiedBusiness: !!job.org?.verified,
      memberSince: job.postedBy.createdAt,
      postsCount,
      hires,
      rating: ratings._avg.posterRating ? Math.round(ratings._avg.posterRating * 10) / 10 : null,
      ratingCount: ratings._count.posterRating,
    },
  });
});

// PATCH /api/jobs/:id — update fields and/or lifecycle action; re-runs the safety gate on publish.
export const PATCH = handler(async (req: NextRequest, ctx: RouteContext<"/api/jobs/[id]">) => {
  const { id } = await ctx.params;
  const user = await requireUser({ roles: ["EMPLOYER", "COMMUNITY", "ADMIN"] });
  const job = await loadManagedJob(id, user);
  const { action, startDate, expiresAt, lat, lng, ...fields } = await parseBody(req, updateJobSchema);

  const data: Prisma.JobUncheckedUpdateInput = { ...fields };
  if (startDate !== undefined) data.startDate = startDate ? new Date(startDate) : null;
  if (expiresAt !== undefined) data.expiresAt = expiresAt ? new Date(expiresAt) : null;
  if (lat !== undefined) data.lat = coarsen(lat);
  if (lng !== undefined) data.lng = coarsen(lng);

  const contentChanged = fields.title !== undefined || fields.description !== undefined || fields.tags !== undefined;
  if (contentChanged) {
    const preview = checkContent({ title: fields.title ?? job.title, description: fields.description ?? job.description, tags: fields.tags ?? job.tags });
    data.suitability = preview.score;
    data.safetyFlags = preview.flags;
  }

  let updated = await db.job.update({ where: { id }, data });
  let message: string | undefined;

  // Editing a live job's content re-runs the gate (EMP-4).
  const republish = contentChanged && updated.status === "PUBLISHED" && !action;
  const transitions: Record<string, () => Promise<void>> = {
    publish: async () => {
      if (!["DRAFT", "PAUSED", "EXPIRED"].includes(updated.status)) throw conflict(`Can't publish a ${updated.status.toLowerCase()} job`);
      const r = await publishJob(updated, user);
      updated = r.job;
      message = r.message;
    },
    pause: async () => {
      if (updated.status !== "PUBLISHED") throw conflict("Only published jobs can be paused");
      updated = await db.job.update({ where: { id }, data: { status: "PAUSED" } });
    },
    resume: async () => {
      if (updated.status !== "PAUSED") throw conflict("Only paused jobs can be resumed");
      const r = await publishJob(updated, user);
      updated = r.job;
      message = r.message;
    },
    fill: async () => {
      if (!["PUBLISHED", "PAUSED"].includes(updated.status)) throw conflict("Only live or paused jobs can be marked filled");
      updated = await db.job.update({ where: { id }, data: { status: "FILLED" } });
      await notifyOpenApplicants(id, updated.title, "filled");
    },
    reopen: async () => {
      if (!["FILLED", "EXPIRED", "ARCHIVED"].includes(updated.status)) throw conflict("This job is already open");
      updated = await db.job.update({ where: { id }, data: { status: "DRAFT", archivedAt: null } });
      const r = await publishJob(updated, user);
      updated = r.job;
      message = r.message;
    },
  };

  if (action) await transitions[action]();
  else if (republish) {
    const r = await publishJob(updated, user);
    updated = r.job;
    message = r.message;
  }

  await audit(user.id, action ? `job.${action}` : "job.update", "job", id);
  return json({ job: updated, message });
});

// DELETE /api/jobs/:id — soft-delete (archive, restorable 30 days); ?hard=true purges if allowed.
export const DELETE = handler(async (req: NextRequest, ctx: RouteContext<"/api/jobs/[id]">) => {
  const { id } = await ctx.params;
  const user = await requireUser({ roles: ["EMPLOYER", "COMMUNITY", "ADMIN"] });
  const job = await loadManagedJob(id, user);
  const hard = new URL(req.url).searchParams.get("hard") === "true";

  await notifyOpenApplicants(id, job.title, "closed");

  if (hard) {
    if (await db.certificate.count({ where: { jobId: id } })) throw badRequest("Jobs with issued certificates can't be permanently deleted. Archive it instead.");
    await db.$transaction([
      db.application.deleteMany({ where: { jobId: id } }),
      db.agentDraft.updateMany({ where: { jobId: id }, data: { jobId: null } }),
      db.job.delete({ where: { id } }),
    ]);
    await audit(user.id, "job.hard_delete", "job", id, { title: job.title });
    return json({ ok: true, deleted: "hard" });
  }

  await db.$transaction([
    db.job.update({ where: { id }, data: { status: "ARCHIVED", archivedAt: new Date() } }),
    db.application.updateMany({ where: { jobId: id, status: { in: ["PENDING_GUARDIAN", "SENT", "VIEWED", "SHORTLISTED"] } }, data: { status: "DECLINED" } }),
  ]);
  await audit(user.id, "job.archive", "job", id);
  return json({ ok: true, deleted: "soft", restorableUntil: new Date(Date.now() + 30 * 864e5) });
});
