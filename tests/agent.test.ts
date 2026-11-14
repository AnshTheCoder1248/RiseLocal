import { describe, expect, it } from "vitest";
import { classify, inferMinAge } from "@/lib/agent/classify";
import { fingerprint } from "@/lib/agent/fingerprint";
import { extract } from "@/lib/agent/extract";
import { jobDraftSchema } from "@/lib/agent/schema";

describe("Scout classify", () => {
  it("auto-rejects a bar-back role", () => {
    const draft = jobDraftSchema.parse({ title: "Bar-back", description: "Support bartenders at The Tavern, serve beer." });
    const c = classify(draft, 0.65);
    expect(c.reject).toBe(true);
    expect(c.flags).toContain("alcohol");
  });
  it("infers minimum age from text", () => {
    expect(inferMinAge("Must be 16 or older")).toBe(16);
    expect(inferMinAge("Ages 14+ welcome")).toBe(14);
    expect(inferMinAge("No age listed")).toBeUndefined();
  });
});

describe("Scout dedupe", () => {
  it("fingerprints are stable across formatting differences", () => {
    expect(fingerprint({ title: "Weekend Stock Clerk!", employer: "Green Market", areaLabel: "Maple Grove" })).toBe(
      fingerprint({ title: "weekend stock clerk", employer: "green  market", areaLabel: "maple grove" }),
    );
  });
});

describe("Scout extract", () => {
  it("maps structured json_api items through the field map", async () => {
    const r = await extract(
      { url: "https://example.com/jobs/1", fields: { name: "Camp counselor", body: "Lead outdoor activities for kids all summer.", kind: "camp-counselor" } },
      { fieldMap: { title: "name", description: "body", category: "kind" } },
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.drafts[0]).toMatchObject({ title: "Camp counselor", category: "camp-counselor" });
  });
  it("quarantines free text when no LLM is configured (never silently dropped)", async () => {
    const r = await extract({ url: "https://example.com/careers", text: "We are hiring..." });
    expect(r.ok).toBe(false);
  });
});
