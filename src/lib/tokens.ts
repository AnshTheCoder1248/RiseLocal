import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "./env";

// Compact signed, expiring tokens for links emailed to guardians.
// Format: base64url(JSON payload).base64url(HMAC-SHA256)

export type TokenPayload =
  | { kind: "guardian-consent"; studentId: string; email: string; exp: number }
  | { kind: "guardian-approve"; applicationId: string; email: string; exp: number }
  // Verified Google identity awaiting the role + date-of-birth step (/signup/google).
  | { kind: "google-signup"; email: string; name: string; image?: string; providerAccountId: string; type: string; exp: number };

const b64 = (buf: Buffer | string) => Buffer.from(buf).toString("base64url");
const sign = (data: string) => createHmac("sha256", env().TOKEN_SECRET).update(data).digest();

export function createToken(payload: TokenPayload) {
  const body = b64(JSON.stringify(payload));
  return `${body}.${b64(sign(body))}`;
}

export function verifyToken<K extends TokenPayload["kind"]>(
  token: string,
  kind: K,
): Extract<TokenPayload, { kind: K }> | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = sign(body);
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as TokenPayload;
    if (payload.kind !== kind || payload.exp < Date.now()) return null;
    return payload as Extract<TokenPayload, { kind: K }>;
  } catch {
    return null;
  }
}

export const days = (n: number) => Date.now() + n * 24 * 60 * 60 * 1000;
