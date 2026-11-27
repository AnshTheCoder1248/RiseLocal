import { db } from "@/lib/db";
import { handler, json, parseBody } from "@/lib/api";
import { markNotificationsSchema } from "@/lib/validation/misc";
import { requireUser } from "@/lib/auth/session";

// GET /api/notifications — inbox (WA-5). ?unread=true for unread only; ?cursor=<id> to page.
export const GET = handler(async (req: Request) => {
  const user = await requireUser({ allowPending: true });
  const params = new URL(req.url).searchParams;
  const cursor = params.get("cursor");
  const [items, unread] = await Promise.all([
    db.notification.findMany({
      where: { userId: user.id, ...(params.get("unread") === "true" && { readAt: null }) },
      orderBy: { createdAt: "desc" },
      take: 30,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
    }),
    db.notification.count({ where: { userId: user.id, readAt: null } }),
  ]);
  return json({ items, unread, nextCursor: items.length === 30 ? items.at(-1)!.id : null });
});

// DELETE /api/notifications — clear the inbox: permanently removes all of this user's notifications.
export const DELETE = handler(async () => {
  const user = await requireUser({ allowPending: true });
  const { count } = await db.notification.deleteMany({ where: { userId: user.id } });
  return json({ deleted: count });
});

// PATCH /api/notifications — mark read: { ids: [...] } or { all: true }.
export const PATCH = handler(async (req: Request) => {
  const user = await requireUser({ allowPending: true });
  const input = await parseBody(req, markNotificationsSchema);
  const { count } = await db.notification.updateMany({
    where: { userId: user.id, readAt: null, ...("ids" in input && { id: { in: input.ids } }) },
    data: { readAt: new Date() },
  });
  return json({ updated: count });
});
