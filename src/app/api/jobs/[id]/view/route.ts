import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { handler, json } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth/session";
import { canManageJob } from "@/lib/jobs/service";
import { publicJobWhere } from "@/lib/safety/gate";
import { checkRateLimit, clientIp, LIMITS } from "@/lib/rate-limit";

// POST /api/jobs/:id/view — count a view of a public job page. Sent by the page once it's
// actually shown (not on prefetch). The poster's own views don't count, and each viewer counts
// at most once per job every 6 hours, so refreshing can't inflate the number.
export const POST = handler(async (req: NextRequest, ctx: RouteContext<"/api/jobs/[id]/view">) => {
  const { id } = await ctx.params;
  const job = await db.job.findFirst({ where: { id, ...publicJobWhere() }, select: { postedById: true, orgId: true } });
  if (!job) return json({ counted: false });

  const viewer = await getCurrentUser();
  if (viewer && canManageJob(job, viewer)) return json({ counted: false });

  const { allowed } = await checkRateLimit(LIMITS.jobView(viewer ? `user:${viewer.id}` : `ip:${clientIp(req)}`, id));
  if (!allowed) return json({ counted: false });

  await db.job.update({ where: { id }, data: { views: { increment: 1 } } });
  return json({ counted: true });
});
