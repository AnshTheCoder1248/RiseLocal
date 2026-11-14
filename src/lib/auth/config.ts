import NextAuth, { CredentialsSignin, type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { z } from "zod";
import { db } from "@/lib/db";
import { verifyPassword } from "./password";
import { checkRateLimit, clientIp, LIMITS } from "@/lib/rate-limit";
import type { Role, UserStatus } from "@/generated/prisma/client";

declare module "next-auth" {
  interface Session {
    user: { id: string; role: Role; status: UserStatus; isMinor: boolean } & DefaultSession["user"];
  }
}

const credentialsSchema = z.object({ email: z.email(), password: z.string().min(1) });

/** Surfaces as `?error=CredentialsSignin&code=rate_limited` on the sign-in page. */
class RateLimitedSignin extends CredentialsSignin {
  code = "rate_limited";
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(db),
  // Credentials requires JWT sessions. Role/status are re-read from the DB on every
  // API request (see requireUser), so a stale token can't grant access.
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 7 },
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(raw, request) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;
        // Every attempt counts (not just failures), so parallel guesses can't race past the check.
        const limit = await checkRateLimit(LIMITS.login(clientIp(request), parsed.data.email));
        if (!limit.allowed) throw new RateLimitedSignin();
        const user = await db.user.findUnique({ where: { email: parsed.data.email.toLowerCase() } });
        if (!user?.passwordHash) return null;
        if (!(await verifyPassword(parsed.data.password, user.passwordHash))) return null;
        if (user.status === "BANNED") return null;
        return { id: user.id, email: user.email, name: user.displayName };
      },
    }),
    // Google sign-in links to an existing account by verified email. New accounts must go
    // through POST /api/auth/signup so role + date of birth (age gate) are captured.
    Google({ allowDangerousEmailAccountLinking: true }),
  ],
  callbacks: {
    async signIn({ user, account }) {
      if (account?.provider !== "google") return true;
      if (!user.email) return false;
      const existing = await db.user.findUnique({ where: { email: user.email.toLowerCase() } });
      return !!existing && existing.status !== "BANNED" ? true : "/signup?reason=no-account";
    },
    async jwt({ token, user }) {
      if (user?.email) {
        const dbUser = await db.user.findUnique({ where: { email: user.email.toLowerCase() } });
        if (dbUser) {
          token.sub = dbUser.id;
          token.role = dbUser.role;
          token.status = dbUser.status;
          token.isMinor = dbUser.isMinor;
        }
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = token.sub!;
      session.user.role = token.role as Role;
      session.user.status = token.status as UserStatus;
      session.user.isMinor = Boolean(token.isMinor);
      return session;
    },
  },
  pages: { signIn: "/login" },
});
