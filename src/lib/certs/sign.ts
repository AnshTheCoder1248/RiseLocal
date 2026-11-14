import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

// Unambiguous alphabet (no 0/O/1/I/L). 7 chars → ~34 bits, shown as XXXX-XXX.
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

export function generateCertCode() {
  let s = "";
  for (let i = 0; i < 7; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

export type SignableCert = {
  code: string;
  studentId: string;
  issuerId: string;
  jobId: string;
  roleTitle: string;
  startDate: Date;
  endDate: Date;
  totalHours: number | null;
  kind: string;
};

function canonical(c: SignableCert) {
  return [c.code, c.studentId, c.issuerId, c.jobId, c.roleTitle, c.startDate.toISOString(), c.endDate.toISOString(), c.totalHours ?? "", c.kind].join("|");
}

/** HMAC over the record's core fields; a PDF embeds this so tampering fails verification (CERT-15). */
export function signCertificate(c: SignableCert) {
  return createHmac("sha256", env().CERT_SIGNING_SECRET).update(canonical(c)).digest("base64url");
}

export function verifyCertificateSignature(c: SignableCert & { signature: string }) {
  const expected = Buffer.from(signCertificate(c));
  const given = Buffer.from(c.signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** "Maya Rodriguez" → "Maya R." — public pages never show a full name (CERT-3, CERT-7). */
export function publicName(displayName: string) {
  const [first, ...rest] = displayName.trim().split(/\s+/);
  const last = rest.at(-1);
  return last ? `${first} ${last[0].toUpperCase()}.` : first;
}
