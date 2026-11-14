import { db } from "@/lib/db";
import { handler, json, parseBody, unprocessable } from "@/lib/api";
import { createWatchSchema } from "@/lib/validation/watches";
import { requireUser } from "@/lib/auth/session";

const MAX_WATCHES = 20;

// GET /api/watches — the student's watches.
export const GET = handler(async () => {
  const user = await requireUser({ roles: ["STUDENT"] });
  const items = await db.watch.findMany({ where: { studentId: user.id }, orderBy: { createdAt: "desc" } });
  return json({ items });
});

// POST /api/watches — save current filters as a named watch (WA-1).
export const POST = handler(async (req: Request) => {
  const user = await requireUser({ roles: ["STUDENT"] });
  const input = await parseBody(req, createWatchSchema);
  if ((await db.watch.count({ where: { studentId: user.id } })) >= MAX_WATCHES) throw unprocessable(`You can have up to ${MAX_WATCHES} watches`);
  const watch = await db.watch.create({ data: { ...input, studentId: user.id } });
  return json({ watch }, 201);
});
