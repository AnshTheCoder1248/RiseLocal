import { db } from "@/lib/db";
import { forbidden, notFound, unprocessable } from "@/lib/api";
import { runPublishGate } from "@/lib/safety/gate";
import { runTask } from "@/lib/tasks";
import { notify } from "@/lib/notifications";
import type { CurrentUser } from "@/lib/auth/session";
import type { Job } from "@/generated/prisma/client";

/** Owner = poster, or a member of the job's employer org. Admins can act on anything. */
export function canManageJob(job: Pick<Job, "postedById" | "orgId">, user: Pick<CurrentUser, "id" | "role" | "orgId">) {
  return user.role === "ADMIN" || job.postedById === user.id || (!!job.orgId && job.orgId === user.orgId && user.role === "EMPLOYER");
}

export async function loadManagedJob(id: string, user: CurrentUser) {
  const job = await db.job.findUnique({ where: { id } });
  if (!job || (job.status === "ARCHIVED" && user.role !== "ADMIN" && job.postedById !== user.id)) throw notFound("Job not found");
  if (!canManageJob(job, user)) throw forbidden();
  return job;
}

/**
 * Run the safety gate and publish. A "held" result keeps the job hidden with a moderation
 * hold (it shows up in the admin content-hold queue); a "rejected" result throws.
 */
export async function publishJob(job: Job, actor: CurrentUser) {
  const poster = job.postedById === actor.id ? actor : await db.user.findUniqueOrThrow({ where: { id: job.postedById } });
  const gate = await runPublishGate(job, poster);

  if (!gate.ok) {
    if (gate.reason === "held") {
      const held = await db.job.update({
        where: { id: job.id },
        data: { moderationHold: true, safetyFlags: gate.safety?.flags ?? [], suitability: gate.safety?.score },
      });
      return { job: held, held: true, message: gate.message };
    }
    throw unprocessable(gate.message, { reason: gate.reason, flags: gate.safety?.flags });
  }

  const published = await db.job.update({
    where: { id: job.id },
    data: {
      status: "PUBLISHED",
      publishedAt: job.publishedAt ?? new Date(),
      moderationHold: false,
      safetyFlags: gate.safety.flags,
      suitability: job.suitability ?? gate.safety.score,
      archivedAt: null,
    },
  });
  await runTask("watch:match", { jobId: published.id });
  return { job: published, held: false as const, message: "Published" };
}

export async function notifyOpenApplicants(jobId: string, title: string, reason: "closed" | "filled") {
  const apps = await db.application.findMany({
    where: { jobId, status: { in: ["PENDING_GUARDIAN", "SENT", "VIEWED", "SHORTLISTED"] } },
    select: { id: true, studentId: true },
  });
  await Promise.all(
    apps.map((a) =>
      notify(a.studentId, "app_update", { applicationId: a.id, jobId, title, status: reason === "filled" ? "FILLED" : "CLOSED" }),
    ),
  );
}
