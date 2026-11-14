import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { handler, json, notFound } from "@/lib/api";
import { requireUser } from "@/lib/auth/session";
import { publicJobWhere } from "@/lib/safety/gate";

// POST/DELETE /api/jobs/:id/save — bookmark a job (WA-4).
export const POST = handler(async (_req: NextRequest, ctx: RouteContext<"/api/jobs/[id]/save">) => {
  const { id } = await ctx.params;
  const user = await requireUser({ roles: ["STUDENT"] });
  if (!(await db.job.count({ where: { id, ...publicJobWhere() } }))) throw notFound("Job not found");
  const saved = await db.savedJob.upsert({ where: { userId_jobId: { userId: user.id, jobId: id } }, create: { userId: user.id, jobId: id }, update: {} });
  return json({ saved }, 201);
});

export const DELETE = handler(async (_req: NextRequest, ctx: RouteContext<"/api/jobs/[id]/save">) => {
  const { id } = await ctx.params;
  const user = await requireUser({ roles: ["STUDENT"] });
  await db.savedJob.deleteMany({ where: { userId: user.id, jobId: id } });
  return json({ ok: true });
});
