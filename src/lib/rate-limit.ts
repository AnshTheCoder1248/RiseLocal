import { createHash } from "node:crypto";
import { ApiError } from "./api";
import { db } from "./db";

// Shared fixed-window rate limiting in Postgres (RateLimitBucket), so every Vercel instance
// counts against the same limit. Each check is one atomic INSERT … ON CONFLICT DO UPDATE:
// the row lock taken by the upsert serializes concurrent requests for a key, so parallel
// requests can't read a stale count and slip past the limit.
//
// Only abuse-prone writes are limited. Board browsing and other GETs are not.

export type RateRule = { key: string; limit: number; windowMs: number };
export type RateResult = { allowed: boolean; count: number; limit: number; resetAt: Date };

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Per-endpoint policies. IP limits are loose enough for a school or library behind one NAT. */
export const LIMITS = {
  // Credential stuffing: tight per account+IP, looser per IP alone.
  login: (ip: string, email: string): RateRule[] => [
    { key: `login:ip-email:${ip}:${email.toLowerCase()}`, limit: 5, windowMs: 15 * MIN },
    { key: `login:ip:${ip}`, limit: 50, windowMs: 15 * MIN },
  ],
  signupIp: (ip: string): RateRule[] => [{ key: `signup:ip:${ip}`, limit: 10, windowMs: HOUR }],
  signupEmail: (email: string): RateRule[] => [{ key: `signup:email:${email.toLowerCase()}`, limit: 3, windowMs: HOUR }],
  // Ready for a password reset endpoint (none exists yet). It also caps reset emails sent to one address.
  passwordReset: (ip: string, email: string): RateRule[] => [
    { key: `pwreset:ip:${ip}`, limit: 10, windowMs: HOUR },
    { key: `pwreset:email:${email.toLowerCase()}`, limit: 3, windowMs: HOUR },
  ],
  // Guardian consent/approval links (signed tokens). This is defense in depth against token probing.
  guardian: (ip: string): RateRule[] => [{ key: `guardian:ip:${ip}`, limit: 20, windowMs: HOUR }],
  jobPost: (userId: string): RateRule[] => [
    { key: `jobpost:user:${userId}:h`, limit: 10, windowMs: HOUR },
    { key: `jobpost:user:${userId}:d`, limit: 30, windowMs: DAY },
  ],
  apply: (userId: string): RateRule[] => [{ key: `apply:user:${userId}`, limit: 20, windowMs: DAY }],
  report: (userId: string): RateRule[] => [{ key: `report:user:${userId}`, limit: 20, windowMs: HOUR }],
  // Job page views: one counted view per viewer (account, else IP) per job every 6 hours.
  jobView: (viewer: string, jobId: string): RateRule[] => [{ key: `view:${viewer}:${jobId}`, limit: 1, windowMs: 6 * HOUR }],
};

/** Keys are hashed so raw IPs and emails never land in the database. */
export const hashKey = (key: string) => createHash("sha256").update(key).digest("base64url").slice(0, 32);

/** Count one hit against `rule` and report whether it's within the limit. */
export async function consume(rule: RateRule, now = new Date()): Promise<RateResult> {
  const resetAt = new Date(now.getTime() + rule.windowMs);
  const [row] = await db.$queryRaw<{ count: number; resetAt: Date }[]>`
    INSERT INTO "RateLimitBucket" ("key", "count", "resetAt")
    VALUES (${hashKey(rule.key)}, 1, ${resetAt})
    ON CONFLICT ("key") DO UPDATE SET
      "count"   = CASE WHEN "RateLimitBucket"."resetAt" <= ${now} THEN 1 ELSE "RateLimitBucket"."count" + 1 END,
      "resetAt" = CASE WHEN "RateLimitBucket"."resetAt" <= ${now} THEN EXCLUDED."resetAt" ELSE "RateLimitBucket"."resetAt" END
    RETURNING "count", "resetAt"`;
  const count = Number(row.count);
  return { allowed: count <= rule.limit, count, limit: rule.limit, resetAt: new Date(row.resetAt) };
}

/**
 * Check every rule (each one counts a hit). Fails open if the database errors: rate limiting
 * shouldn't take down an endpoint, and the endpoints themselves need the database anyway.
 */
export async function checkRateLimit(rules: RateRule[], now = new Date()): Promise<{ allowed: boolean; retryAfterSec: number }> {
  let retryAfterSec = 0;
  for (const rule of rules) {
    try {
      const r = await consume(rule, now);
      if (!r.allowed) retryAfterSec = Math.max(retryAfterSec, Math.ceil((r.resetAt.getTime() - now.getTime()) / 1000));
    } catch (err) {
      console.error(`[rate-limit] check failed for ${rule.key.split(":")[0]}; allowing request`, err);
    }
  }
  return { allowed: retryAfterSec === 0, retryAfterSec };
}

/** Throws a 429 ApiError with Retry-After when any rule is over its limit. */
export async function enforceRateLimit(rules: RateRule[]) {
  const { allowed, retryAfterSec } = await checkRateLimit(rules);
  if (!allowed) {
    throw new ApiError(429, "Too many requests — try again in a bit", { retryAfterSec }, { "Retry-After": String(retryAfterSec) });
  }
}

/** Client IP. On Vercel, x-forwarded-for is set by the edge and can't be spoofed by the client. */
export function clientIp(req: Request) {
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.headers.get("x-real-ip") || "local";
}
