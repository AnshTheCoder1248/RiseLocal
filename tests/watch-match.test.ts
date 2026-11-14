import { describe, expect, it } from "vitest";
import { matchesFilters, type MatchableJob } from "@/lib/jobs/match";

const job: MatchableJob = {
  title: "After-school dog walker", description: "Walk two dogs", category: "pet-care", tags: ["dogs"],
  payType: "HOURLY", payMin: 1800, payMax: 1800, minAge: 14, schedule: "after-school", remote: false,
  source: "EMPLOYER", lat: 45.07, lng: -93.46, publishedAt: new Date(), orgVerified: true,
};

describe("watch matching", () => {
  it("matches category + pay + radius", () => {
    expect(matchesFilters(job, { category: ["pet-care"], payMin: 1500, lat: 45.07, lng: -93.46, radiusMi: 2 })).toBe(true);
  });
  it("rejects when pay is below the watch minimum", () => {
    expect(matchesFilters(job, { payMin: 2000 })).toBe(false);
  });
  it("rejects outside the radius", () => {
    expect(matchesFilters(job, { lat: 45.5, lng: -93.46, radiusMi: 2 })).toBe(false);
  });
  it("respects eligibility by age", () => {
    expect(matchesFilters({ ...job, minAge: 16 }, { eligibleOnly: true }, 15)).toBe(false);
  });
  it("matches all search terms", () => {
    expect(matchesFilters(job, { q: "dog walker" })).toBe(true);
    expect(matchesFilters(job, { q: "cat sitter" })).toBe(false);
  });
});
