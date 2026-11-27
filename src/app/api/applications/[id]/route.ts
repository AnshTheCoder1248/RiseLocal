import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { handler, json, parseBody, notFound, forbidden, conflict, badRequest } from "@/lib/api";
import { updateApplicationSchema } from "@/lib/validation/applications";
import { requireUser } from "@/lib/auth/session";
import { canManageJob } from "@/lib/jobs/service";
import { notify } from "@/lib/notifications";
import type { Prisma } from "@/generated/prisma/client";

// PATCH /api/applications/:id — poster moves pipeline stage; student withdraws; both confirm completion.
export const PATCH = handler(async (req: NextRequest, ctx: RouteContext<"/api/applications/[id]">) => {
  const { id } = await ctx.params;
  const user = await requireUser();
  const input = await parseBody(req, updateApplicationSchema);

  const app = await db.application.findUnique({ where: { id }, include: { job: true } });
  if (!app) throw notFound("Application not found");
  const isStudent = app.studentId === user.id;
  const isPoster = canManageJob(app.job, user);
  if (!isStudent && !isPoster) throw forbidden();

  const data: Prisma.ApplicationUpdateInput = {};
  let notifyUserId: string | undefined;

  switch (input.action) {
    case "move":
      if (!isPoster) throw forbidden("Only the poster can move applicants");
      if (["WITHDRAWN", "PENDING_GUARDIAN"].includes(app.status)) throw conflict("This application isn't active");
      // "Viewed" only applies to a new application: it never demotes a shortlisted or hired
      // applicant, and a repeat (another tab, a retry) changes nothing and notifies no one.
      if (input.status === "VIEWED" && app.status !== "SENT") return json({ application: app });
      data.status = input.status;
      notifyUserId = app.studentId;
      break;
    case "withdraw":
      if (!isStudent) throw forbidden("Only the student can withdraw");
      if (["HIRED", "WITHDRAWN"].includes(app.status)) throw conflict(`Can't withdraw a ${app.status.toLowerCase()} application`);
      data.status = "WITHDRAWN";
      notifyUserId = app.job.postedById;
      break;
    case "complete":
      if (app.status !== "HIRED") throw conflict("Only hired engagements can be marked complete");
      if (isStudent) {
        data.studentConfirmedAt = app.studentConfirmedAt ?? new Date();
        if (input.rating) data.posterRating = input.rating;
        notifyUserId = app.job.postedById;
      } else {
        data.posterConfirmedAt = app.posterConfirmedAt ?? new Date();
        if (input.hoursLogged != null) data.hoursLogged = input.hoursLogged;
        if (input.rating) data.studentRating = input.rating;
        notifyUserId = app.studentId;
      }
      if (!isStudent && input.hoursLogged == null && app.hoursLogged == null) throw badRequest("Log the hours worked when confirming completion");
      break;
  }

  const updated = await db.application.update({ where: { id }, data });
  if (notifyUserId) {
    await notify(
      notifyUserId,
      "app_update",
      { applicationId: id, jobId: app.jobId, title: app.job.title, status: updated.status, action: input.action },
      // Two simultaneous "viewed" requests can both see SENT; the dedupe key keeps it to one notification.
      updated.status === "VIEWED" ? { dedupeKey: `app-viewed:${id}` } : {},
    );
  }
  return json({ application: updated });
});
