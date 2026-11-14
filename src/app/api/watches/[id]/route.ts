import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { handler, json, parseBody, notFound } from "@/lib/api";
import { updateWatchSchema } from "@/lib/validation/watches";
import { requireUser } from "@/lib/auth/session";

async function ownWatch(id: string, studentId: string) {
  const watch = await db.watch.findFirst({ where: { id, studentId } });
  if (!watch) throw notFound("Watch not found");
  return watch;
}

// PATCH /api/watches/:id — edit channels/frequency; pause/enable (WA-3).
export const PATCH = handler(async (req: NextRequest, ctx: RouteContext<"/api/watches/[id]">) => {
  const { id } = await ctx.params;
  const user = await requireUser({ roles: ["STUDENT"] });
  await ownWatch(id, user.id);
  const input = await parseBody(req, updateWatchSchema);
  const watch = await db.watch.update({ where: { id }, data: input });
  return json({ watch });
});

export const DELETE = handler(async (_req: NextRequest, ctx: RouteContext<"/api/watches/[id]">) => {
  const { id } = await ctx.params;
  const user = await requireUser({ roles: ["STUDENT"] });
  await ownWatch(id, user.id);
  await db.watch.delete({ where: { id } });
  return json({ ok: true });
});
