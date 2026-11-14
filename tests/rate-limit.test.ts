/* eslint-disable @typescript-eslint/no-explicit-any -- tests drive the untyped in-memory Prisma fake */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", async () => ({ db: (await import("./helpers/fake-db")).createFakeDb() }));

import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { checkRateLimit, clientIp, consume, enforceRateLimit, hashKey, LIMITS } from "@/lib/rate-limit";

const fake = db as any;
beforeEach(() => {
  for (const k of Object.keys(fake.tables)) delete fake.tables[k];
});
afterEach(() => vi.restoreAllMocks());

const rule = { key: "login:ip-email:1.2.3.4:a@b.c", limit: 3, windowMs: 60_000 };

describe("Postgres rate limiting", () => {
  it("allows up to the limit, then blocks until the window resets", async () => {
    const t0 = new Date("2026-11-14T10:00:00Z");
    const results = [];
    for (let i = 0; i < 4; i++) results.push((await consume(rule, t0)).allowed);
    expect(results).toEqual([true, true, true, false]);
    expect((await consume(rule, new Date(t0.getTime() + 59_000))).allowed).toBe(false);
    const after = await consume(rule, new Date(t0.getTime() + 60_000));
    expect(after).toMatchObject({ allowed: true, count: 1 });
  });

  it("concurrent requests can't exceed the limit", async () => {
    const now = new Date();
    const results = await Promise.all(Array.from({ length: 25 }, () => consume({ ...rule, limit: 5 }, now)));
    expect(results.filter((r) => r.allowed)).toHaveLength(5);
    expect(results.map((r) => r.count).sort((a, b) => a - b)).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
  });

  it("stores hashed keys, never raw IPs or emails", async () => {
    await consume(rule);
    const [bucket] = fake.tables.rateLimitBucket;
    expect(bucket.key).toBe(hashKey(rule.key));
    expect(bucket.key).not.toContain("1.2.3.4");
    expect(bucket.key).not.toContain("a@b.c");
  });

  it("enforceRateLimit throws 429 with Retry-After", async () => {
    const rules = [{ ...rule, limit: 1 }];
    await enforceRateLimit(rules);
    const err = await enforceRateLimit(rules).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(429);
    expect(Number(err.headers["Retry-After"])).toBeGreaterThan(0);
    expect(Number(err.headers["Retry-After"])).toBeLessThanOrEqual(60);
  });

  it("blocks when any one of several rules is exceeded", async () => {
    const now = new Date();
    for (let i = 0; i < 5; i++) expect((await checkRateLimit(LIMITS.login("9.9.9.9", "kid@example.com"), now)).allowed).toBe(true);
    // 6th try on the same account from the same IP is blocked…
    expect((await checkRateLimit(LIMITS.login("9.9.9.9", "kid@example.com"), now)).allowed).toBe(false);
    // …but another student behind the same school NAT can still sign in.
    expect((await checkRateLimit(LIMITS.login("9.9.9.9", "other@example.com"), now)).allowed).toBe(true);
  });

  it("treats emails case-insensitively", async () => {
    const now = new Date();
    for (let i = 0; i < 3; i++) await checkRateLimit(LIMITS.signupEmail("Kid@Example.com"), now);
    expect((await checkRateLimit(LIMITS.signupEmail("kid@example.com"), now)).allowed).toBe(false);
  });

  it("fails open if the database errors", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(fake, "$queryRaw").mockRejectedValueOnce(new Error("connection reset"));
    expect(await checkRateLimit([rule])).toEqual({ allowed: true, retryAfterSec: 0 });
  });

  it("has stricter limits on sensitive endpoints", () => {
    const strictest = (rules: { limit: number; windowMs: number }[]) => Math.min(...rules.map((r) => r.limit / (r.windowMs / 36e5)));
    expect(strictest(LIMITS.login("ip", "e"))).toBeLessThanOrEqual(20); // ≤ 20/hour per account
    expect(strictest(LIMITS.passwordReset("ip", "e"))).toBeLessThanOrEqual(3);
    expect(strictest(LIMITS.jobPost("u"))).toBeLessThanOrEqual(10);
    expect(strictest(LIMITS.guardian("ip"))).toBeLessThanOrEqual(20);
  });

  it("reads the client IP from proxy headers", () => {
    expect(clientIp(new Request("http://x", { headers: { "x-forwarded-for": "203.0.113.5, 10.0.0.1" } }))).toBe("203.0.113.5");
    expect(clientIp(new Request("http://x", { headers: { "x-real-ip": "203.0.113.9" } }))).toBe("203.0.113.9");
    expect(clientIp(new Request("http://x"))).toBe("local");
  });
});
