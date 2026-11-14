import { db } from "@/lib/db";
import { handler, json, parseBody, badRequest } from "@/lib/api";
import { moderationActionSchema } from "@/lib/validation/misc";
import { requireUser } from "@/lib/auth/session";
import { publishJob } from "@/lib/jobs/service";
import { runTask } from "@/lib/tasks";
import { notify } from "@/lib/notifications";
import { audit } from "@/lib/audit";

// GET /api/admin/moderation — report queue, content holds, verification requests, admin draft queue (MOD-1..3, AG-6).
export const GET = handler(async () => {
  await requireUser({ roles: ["ADMIN"] });
  const [reports, holds, verifications, drafts] = await Promise.all([
    db.report.findMany({ where: { status: { in: ["OPEN", "ESCALATED"] } }, orderBy: { createdAt: "asc" }, include: { reporter: { select: { id: true, displayName: true } } } }),
    db.job.findMany({ where: { moderationHold: true, archivedAt: null }, orderBy: { updatedAt: "asc" }, select: { id: true, title: true, source: true, safetyFlags: true, suitability: true, postedById: true, updatedAt: true } }),
    db.employerOrg.findMany({ where: { verificationStatus: "PENDING" }, orderBy: { createdAt: "asc" } }),
    db.agentDraft.findMany({ where: { reviewState: "pending", orgId: null }, orderBy: [{ confidence: { sort: "desc", nulls: "last" } }], include: { job: true } }),
  ]);
  const now = Date.now();
  const age = (d: Date) => Math.round((now - d.getTime()) / 36e5);
  return json({
    reports: reports.map((r) => ({ ...r, hoursInQueue: age(r.createdAt) })),
    holds: holds.map((h) => ({ ...h, hoursInQueue: age(h.updatedAt) })),
    verifications,
    drafts,
  });
});

// POST /api/admin/moderation — triage an item: { kind, id, action, reason }.
export const POST = handler(async (req: Request) => {
  const admin = await requireUser({ roles: ["ADMIN"] });
  const { kind, id, action, reason } = await parseBody(req, moderationActionSchema);
  let result: unknown;

  switch (kind) {
    case "report": {
      const status = action === "approve" ? "APPROVED" : action === "escalate" ? "ESCALATED" : "REJECTED";
      const report = await db.report.update({ where: { id }, data: { status, resolution: reason, resolvedAt: action === "escalate" ? null : new Date() } });
      // "approve" = report upheld → remove the content / suspend the user. "ban" bans the user.
      if (action === "approve" || action === "ban") {
        if (report.targetType === "user") {
          await db.user.update({ where: { id: report.targetId }, data: { status: action === "ban" ? "BANNED" : "SUSPENDED" } });
        } else if (report.targetType === "job" || report.targetType === "gig") {
          const job = await db.job.update({ where: { id: report.targetId }, data: { status: "ARCHIVED", archivedAt: new Date(), moderationHold: true } });
          await notify(job.postedById, "system", { type: "content_removed", jobId: job.id, reason: reason ?? report.reason });
          if (action === "ban") await db.user.update({ where: { id: job.postedById }, data: { status: "BANNED" } });
        }
      } else if (action === "reject" && (report.targetType === "job" || report.targetType === "gig")) {
        const stillOpen = await db.report.count({ where: { targetId: report.targetId, status: "OPEN" } });
        if (!stillOpen) await db.job.update({ where: { id: report.targetId }, data: { moderationHold: false } });
      }
      result = report;
      break;
    }
    case "hold": {
      const job = await db.job.findUniqueOrThrow({ where: { id } });
      if (action === "approve") {
        // Moderator override: clear the hold and publish without re-running the content filter.
        result = await db.job.update({ where: { id }, data: { moderationHold: false, status: "PUBLISHED", publishedAt: job.publishedAt ?? new Date() } });
        await runTask("watch:match", { jobId: id });
      } else if (action === "reject") {
        result = await db.job.update({ where: { id }, data: { status: "ARCHIVED", archivedAt: new Date() } });
      } else throw badRequest("Holds can be approved or rejected");
      await notify(job.postedById, "system", { type: action === "approve" ? "content_approved" : "content_rejected", jobId: id, reason });
      break;
    }
    case "verification": {
      if (!["approve", "reject"].includes(action)) throw badRequest("Verification can be approved or rejected");
      result = await db.employerOrg.update({
        where: { id },
        data: action === "approve" ? { verified: true, verificationStatus: "VERIFIED" } : { verified: false, verificationStatus: "DENIED" },
      });
      break;
    }
    case "draft": {
      const draft = await db.agentDraft.findUniqueOrThrow({ where: { id }, include: { job: true } });
      if (!draft.job) throw badRequest("Draft has no job");
      if (action === "approve") {
        const r = await publishJob(draft.job, admin);
        await db.agentDraft.update({ where: { id }, data: { reviewState: "approved" } });
        result = r;
      } else {
        await db.agentDraft.update({ where: { id }, data: { reviewState: "dismissed" } });
        result = await db.job.update({ where: { id: draft.job.id }, data: { status: "ARCHIVED", archivedAt: new Date() } });
      }
      break;
    }
  }

  await audit(admin.id, `moderation.${kind}.${action}`, kind, id, reason ? { reason } : undefined);
  return json({ ok: true, result });
});
