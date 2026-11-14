import { describe, expect, it } from "vitest";
import { createToken, verifyToken, days } from "@/lib/tokens";
import { generateCertCode, publicName, signCertificate, verifyCertificateSignature } from "@/lib/certs/sign";

process.env.DATABASE_URL ??= "postgresql://test";

describe("guardian tokens", () => {
  it("round-trips and rejects tampering, wrong kind, and expiry", () => {
    const t = createToken({ kind: "guardian-consent", studentId: "s1", email: "g@example.com", exp: days(1) });
    expect(verifyToken(t, "guardian-consent")?.studentId).toBe("s1");
    expect(verifyToken(t, "guardian-approve")).toBeNull();
    expect(verifyToken(t.slice(0, -2) + "xx", "guardian-consent")).toBeNull();
    const expired = createToken({ kind: "guardian-consent", studentId: "s1", email: "g@example.com", exp: Date.now() - 1 });
    expect(verifyToken(expired, "guardian-consent")).toBeNull();
  });
});

describe("certificates", () => {
  const cert = {
    code: generateCertCode(), studentId: "s1", issuerId: "i1", jobId: "j1", roleTitle: "Dog Walker",
    startDate: new Date("2026-04-01"), endDate: new Date("2026-09-01"), totalHours: 48, kind: "work",
  };
  it("detects altered fields (CERT-15)", () => {
    const signature = signCertificate(cert);
    expect(verifyCertificateSignature({ ...cert, signature })).toBe(true);
    expect(verifyCertificateSignature({ ...cert, totalHours: 480, signature })).toBe(false);
  });
  it("formats codes and public names", () => {
    expect(cert.code).toMatch(/^[2-9A-Z]{4}-[2-9A-Z]{3}$/);
    expect(publicName("Maya Rodriguez")).toBe("Maya R.");
    expect(publicName("Maya")).toBe("Maya");
  });
});
