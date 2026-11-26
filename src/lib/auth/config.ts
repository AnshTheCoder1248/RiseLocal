import NextAuth, { CredentialsSignin, type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { z } from "zod";
import { db } from "@/lib/db";
import { verifyPassword } from "./password";
import { cookies } from "next/headers";
import { checkRateLimit, clientIp, LIMITS } from "@/lib/rate-limit";
import { createToken } from "@/lib/tokens";

export const GOOGLE_SIGNUP_COOKIE = "rl_google_signup";
const GOOGLE_SIGNUP_TTL_S = 30 * 60;
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
    // Google sign-in links to an existing account by verified email. A new Google user is
    // sent to /signup/google to give role + date of birth (age gate) before any row is created.
    Google({ allowDangerousEmailAccountLinking: true }),
  ],
  callbacks: {
    async signIn({ user, account, profile }) {
      if (account?.provider !== "google") return true;
      if (!user.email || profile?.email_verified !== true) return false;
      const email = user.email.toLowerCase();
      const existing = await db.user.findUnique({ where: { email } });
      if (existing) return existing.status !== "BANNED";

      // New user: hold the verified identity in a short-lived signed cookie, store nothing yet.
      const token = createToken({
        kind: "google-signup",
        email,
        name: user.name ?? email.split("@")[0],
        image: user.image ?? undefined,
        providerAccountId: account.providerAccountId,
        type: account.type,
        exp: Date.now() + GOOGLE_SIGNUP_TTL_S * 1000,
      });
      (await cookies()).set(GOOGLE_SIGNUP_COOKIE, token, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: GOOGLE_SIGNUP_TTL_S,
      });
      return "/signup/google";
    },
    async jwt({ token, user, account }) {
      if (user?.email) {
        const dbUser = await db.user.findUnique({ where: { email: user.email.toLowerCase() } });
        if (dbUser) {
          token.sub = dbUser.id;
          token.role = dbUser.role;
          token.status = dbUser.status;
          token.isMinor = dbUser.isMinor;
          // Keep the Google profile photo current; the site header shows it.
          if (account?.provider === "google" && user.image && user.image !== dbUser.image) {
            await db.user.update({ where: { id: dbUser.id }, data: { image: user.image } });
          }
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
