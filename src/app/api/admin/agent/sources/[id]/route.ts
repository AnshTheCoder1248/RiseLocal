import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { handler, json, parseBody } from "@/lib/api";
import { agentSourceSchema } from "@/lib/validation/misc";
import { requireUser } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import type { Prisma } from "@/generated/prisma/client";

const updateSchema = agentSourceSchema.partial();

export const GET = handler(async (_req: NextRequest, ctx: RouteContext<"/api/admin/agent/sources/[id]">) => {
  const { id } = await ctx.params;
  await requireUser({ roles: ["ADMIN"] });
  const source = await db.agentSource.findUniqueOrThrow({ where: { id }, include: { runs: { orderBy: { startedAt: "desc" }, take: 50 } } });
  return json({ source });
});

// PATCH — edit, pause (enabled:false) or resume a source.
export const PATCH = handler(async (req: NextRequest, ctx: RouteContext<"/api/admin/agent/sources/[id]">) => {
  const { id } = await ctx.params;
  const admin = await requireUser({ roles: ["ADMIN"] });
  const { hints, ...input } = await parseBody(req, updateSchema);
  const source = await db.agentSource.update({ where: { id }, data: { ...input, ...(hints !== undefined && { hints: hints as Prisma.InputJsonValue }) } });
  await audit(admin.id, "agent.source.update", "agent_source", id, input as Prisma.InputJsonValue);
  return json({ source });
});

export const DELETE = handler(async (_req: NextRequest, ctx: RouteContext<"/api/admin/agent/sources/[id]">) => {
  const { id } = await ctx.params;
  const admin = await requireUser({ roles: ["ADMIN"] });
  // Keep run history/provenance: disable rather than delete when runs exist.
  const runs = await db.agentRun.count({ where: { sourceId: id } });
  if (runs) await db.agentSource.update({ where: { id }, data: { enabled: false } });
  else await db.agentSource.delete({ where: { id } });
  await audit(admin.id, runs ? "agent.source.disable" : "agent.source.delete", "agent_source", id);
  return json({ ok: true, disabledInstead: runs > 0 });
});
