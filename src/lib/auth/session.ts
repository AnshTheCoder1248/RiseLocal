import { auth } from "./config";
import { db } from "@/lib/db";
import { forbidden, unauthorized } from "@/lib/api";
import type { Role, User } from "@/generated/prisma/client";

export type CurrentUser = Pick<User, "id" | "role" | "status" | "isMinor" | "orgId" | "dateOfBirth" | "displayName" | "email">;

/** Session user re-read from the database — never trust role/status from the client. */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  return db.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, role: true, status: true, isMinor: true, orgId: true, dateOfBirth: true, displayName: true, email: true },
  });
}

type Options = { roles?: Role[]; allowPending?: boolean };

export async function requireUser({ roles, allowPending = false }: Options = {}): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw unauthorized();
  if (user.status === "BANNED" || user.status === "SUSPENDED") throw forbidden("Your account is not active");
  if (user.status === "PENDING" && !allowPending) {
    throw forbidden(
      user.isMinor ? "Your account is waiting for guardian consent" : "Please finish activating your account",
    );
  }
  if (roles && !roles.includes(user.role)) throw forbidden();
  return user;
}

export const isAdmin = (u: Pick<CurrentUser, "role">) => u.role === "ADMIN";
