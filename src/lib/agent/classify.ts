import { checkContent, type SafetyFlag } from "@/lib/safety/filter";
import type { JobDraftData } from "./schema";

// Stage 3 — Classify (AG-5): teen-suitability score, inferred min age, safety flags.

export type Classification = { suitability: number; minAge: number; flags: SafetyFlag[]; reject: boolean; reason?: string };

export function inferMinAge(text: string): number | undefined {
  const m = text.match(/\b(?:ages?|must be(?: at least)?|minimum age(?: of)?)\s*(1[3-8])\+?|\b(1[3-8])\s*(?:\+|or older|years? (?:of age )?or older)/i);
  const n = Number(m?.[1] ?? m?.[2]);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export function classify(draft: JobDraftData, rejectBelow: number): Classification {
  const result = checkContent({ title: draft.title, description: draft.description });
  const minAge = draft.minAge ?? inferMinAge(`${draft.title} ${draft.description}`) ?? 16;
  const reject = result.decision === "reject" || result.score < rejectBelow;
  return {
    suitability: result.score,
    minAge,
    flags: result.flags,
    reject,
    reason: reject ? (result.flags.length ? result.flags.join(", ") : `suitability ${result.score} < ${rejectBelow}`) : undefined,
  };
}
