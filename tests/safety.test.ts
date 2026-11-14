import { describe, expect, it } from "vitest";
import { checkContent } from "@/lib/safety/filter";

describe("content safety filter", () => {
  it("passes a normal gig", () => {
    const r = checkContent({ title: "After-school dog walker", description: "Walk two friendly dogs on weekdays near the park." });
    expect(r.decision).toBe("pass");
    expect(r.score).toBe(1);
  });
  it("holds a gig with a phone number / 'text me' (acceptance: Safety gate)", () => {
    const r = checkContent({ title: "Yard help", description: "Rake leaves Saturday. Text me at 612-555-0199." });
    expect(r.decision).toBe("hold");
    expect(r.flags).toEqual(expect.arrayContaining(["pii_phone", "off_platform_contact"]));
  });
  it("rejects alcohol service (acceptance: Suitability)", () => {
    const r = checkContent({ title: "Bar-back", description: "Restock the bar and help bartenders at The Tavern." });
    expect(r.decision).toBe("reject");
    expect(r.flags).toContain("alcohol");
  });
  it("rejects door-to-door sales", () => {
    expect(checkContent({ title: "Sales", description: "Door-to-door magazine sales, commission only." }).decision).toBe("reject");
  });
});
