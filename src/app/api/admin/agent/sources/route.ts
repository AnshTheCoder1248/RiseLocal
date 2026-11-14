import { db } from "@/lib/db";
import { handler, json, parseBody } from "@/lib/api";
import { agentSourceSchema } from "@/lib/validation/misc";
import { requireUser } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import type { Prisma } from "@/generated/prisma/client";

// GET /api/admin/agent/sources — sources with recent run history (MOD-4, AG-8).
export const GET = handler(async () => {
  await requireUser({ roles: ["ADMIN"] });
  const items = await db.agentSource.findMany({
    orderBy: { createdAt: "desc" },
    include: { runs: { orderBy: { startedAt: "desc" }, take: 5 } },
  });
  const since = new Date(Date.now() - 864e5);
  const [found, spend, inReview] = await Promise.all([
    db.agentRun.aggregate({ where: { startedAt: { gte: since } }, _sum: { found: true } }),
    db.agentRun.aggregate({ where: { startedAt: { gte: since } }, _sum: { costUsd: true } }),
    db.agentDraft.count({ where: { reviewState: "pending" } }),
  ]);
  return json({ items, stats: { found24h: found._sum.found ?? 0, spend24h: spend._sum.costUsd ?? 0, inReview } });
});

// POST /api/admin/agent/sources — add a source (AG-1).
export const POST = handler(async (req: Request) => {
  const admin = await requireUser({ roles: ["ADMIN"] });
  const { hints, ...input } = await parseBody(req, agentSourceSchema);
  const source = await db.agentSource.create({ data: { ...input, hints: hints as Prisma.InputJsonValue | undefined } });
  await audit(admin.id, "agent.source.create", "agent_source", source.id);
  return json({ source }, 201);
});
