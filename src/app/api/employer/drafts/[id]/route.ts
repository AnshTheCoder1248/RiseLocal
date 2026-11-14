import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { handler, json, parseBody, notFound, forbidden } from "@/lib/api";
import { draftActionSchema } from "@/lib/validation/misc";
import { requireUser } from "@/lib/auth/session";
import { publishJob } from "@/lib/jobs/service";
import { audit } from "@/lib/audit";

// PATCH /api/employer/drafts/:id — approve (publish via safety gate) or dismiss a Scout draft (EMP-1, AG-6).
export const PATCH = handler(async (req: NextRequest, ctx: RouteContext<"/api/employer/drafts/[id]">) => {
  const { id } = await ctx.params;
  const user = await requireUser({ roles: ["EMPLOYER", "ADMIN"] });
  const { action } = await parseBody(req, draftActionSchema);

  const draft = await db.agentDraft.findUnique({ where: { id }, include: { job: true } });
  if (!draft?.job) throw notFound("Draft not found");
  if (user.role !== "ADMIN" && draft.orgId !== user.orgId) throw forbidden();

  if (action === "dismiss") {
    await db.$transaction([
      db.agentDraft.update({ where: { id }, data: { reviewState: "dismissed" } }),
      db.job.update({ where: { id: draft.job.id }, data: { status: "ARCHIVED", archivedAt: new Date() } }),
    ]);
    await audit(user.id, "draft.dismiss", "agent_draft", id);
    return json({ ok: true, reviewState: "dismissed" });
  }

  if (user.role === "EMPLOYER") {
    const org = await db.employerOrg.findUnique({ where: { id: user.orgId! } });
    if (!org?.verified) throw forbidden("Verify your business before publishing Scout drafts");
    // Hand ownership to the approving employer.
    await db.job.update({ where: { id: draft.job.id }, data: { postedById: user.id } });
  }
  const job = await db.job.findUniqueOrThrow({ where: { id: draft.job.id } });
  const result = await publishJob(job, user);
  await db.agentDraft.update({ where: { id }, data: { reviewState: "approved" } });
  await audit(user.id, "draft.approve", "agent_draft", id, { held: result.held });
  return json({ job: result.job, held: result.held, message: result.message });
});
