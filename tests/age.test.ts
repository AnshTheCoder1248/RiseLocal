import { describe, expect, it } from "vitest";
import { ageBand, ageOn, needsGuardian } from "@/lib/auth/age";

describe("age gate", () => {
  const at = new Date("2026-11-14");
  it("computes age with birthday not yet reached", () => {
    expect(ageOn(new Date("2011-11-15"), at)).toBe(14);
    expect(ageOn(new Date("2011-11-14"), at)).toBe(15);
  });
  it("requires a guardian for 13–15 only", () => {
    expect(needsGuardian(12)).toBe(false);
    expect(needsGuardian(13)).toBe(true);
    expect(needsGuardian(15)).toBe(true);
    expect(needsGuardian(16)).toBe(false);
  });
  it("bands ages", () => {
    expect(ageBand(14)).toBe("13-15");
    expect(ageBand(17)).toBe("16-17");
    expect(ageBand(18)).toBe("18+");
  });
});
