import { describe, expect, it } from "vitest";
import { draftConfidence, fieldConfidence, NEEDS_REVIEW_BELOW } from "@/lib/agent/confidence";
import { extract } from "@/lib/agent/extract";

const complete = {
  title: "Weekend cashier", description: "Ring up customers and keep the front tidy.", employer: "Green Market",
  payType: "HOURLY", payMin: 1500, payMax: 1500, minAge: 16, schedule: "weekends", areaLabel: "Maple Grove · 55311",
};

describe("Scout draft confidence", () => {
  it("scores a complete listing at 100%", () => {
    expect(draftConfidence(null, { ...complete, confidence: fieldConfidence(complete) })).toBe(1);
  });

  it("flags a listing with no wage, age or schedule for review", () => {
    const sparse = { ...complete, payMin: null, payMax: null, minAge: null, schedule: null };
    const score = draftConfidence(null, sparse);
    expect(score).toBeCloseTo(4 / 7);
    expect(score).toBeLessThan(NEEDS_REVIEW_BELOW);
  });

  it("counts volunteer work as having a stated wage", () => {
    expect(fieldConfidence({ ...complete, payType: "VOLUNTEER", payMin: null, payMax: null }).pay).toBe(1);
  });

  it("prefers a stored confidence, then the model's per-field scores", () => {
    expect(draftConfidence(0.42, complete)).toBe(0.42);
    expect(draftConfidence(null, { ...complete, confidence: { title: 0.9, pay: 0.5 } })).toBeCloseTo(0.7);
  });

  it("gives structured feed items completeness-based confidences at extraction", async () => {
    const r = await extract({ url: "https://example.com/j/1", fields: { ...complete, minAge: null, payMin: null, payMax: null } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.drafts[0].confidence).toMatchObject({ title: 1, pay: 0, minAge: 0, schedule: 1 });
  });
});
