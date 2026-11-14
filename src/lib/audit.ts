import { db } from "./db";
import type { Prisma } from "@/generated/prisma/client";

export function audit(
  actorId: string | null,
  action: string,
  targetType: string,
  targetId: string,
  meta?: Prisma.InputJsonValue,
) {
  return db.auditLog.create({ data: { actorId, action, targetType, targetId, meta } });
}
