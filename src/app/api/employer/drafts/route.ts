import { db } from "@/lib/db";
import { handler, json, forbidden } from "@/lib/api";
import { requireUser } from "@/lib/auth/session";

// GET /api/employer/drafts — Scout-surfaced drafts matched to this employer (EMP-1).
export const GET = handler(async () => {
  const user = await requireUser({ roles: ["EMPLOYER"] });
  if (!user.orgId) throw forbidden("Set up your business first");
  const items = await db.agentDraft.findMany({
    where: { orgId: user.orgId, reviewState: "pending" },
    orderBy: [{ confidence: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
    select: { id: true, sourceUrl: true, confidence: true, lastSeenAt: true, createdAt: true, job: true },
  });
  return json({ items });
});
