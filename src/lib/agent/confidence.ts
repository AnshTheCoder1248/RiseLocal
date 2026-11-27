/**
 * Extraction confidence for Scout drafts.
 *
 * LLM-extracted drafts carry per-field confidences from the model. Structured feeds (json_api)
 * don't, so for those each key field scores 1 when the listing provides it and 0 when it's
 * missing. The average is then "how complete is this listing" — a listing with no pay or
 * minimum age scores low and is flagged for review before anyone publishes it.
 */

/** Below this, a draft is shown as "Needs review". */
export const NEEDS_REVIEW_BELOW = 0.7;

type DraftLike = {
  title?: unknown; description?: unknown; employer?: unknown; payType?: unknown;
  payMin?: unknown; payMax?: unknown; minAge?: unknown; schedule?: unknown; areaLabel?: unknown;
};

const present = (v: unknown) => v != null && v !== "";

/** Per-field confidence from completeness: 1 if the listing states it, 0 if not. */
export function fieldConfidence(d: DraftLike): Record<string, number> {
  return {
    title: present(d.title) ? 1 : 0,
    description: present(d.description) ? 1 : 0,
    employer: present(d.employer) ? 1 : 0,
    pay: d.payType === "VOLUNTEER" || present(d.payMin) || present(d.payMax) ? 1 : 0,
    minAge: present(d.minAge) ? 1 : 0,
    schedule: present(d.schedule) ? 1 : 0,
    areaLabel: present(d.areaLabel) ? 1 : 0,
  };
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** A draft's confidence (0–1): the stored value, else worked out from its fields. */
export function draftConfidence(stored: number | null, rawPayload: unknown): number {
  if (stored != null) return stored;
  const p = (rawPayload ?? {}) as DraftLike & { confidence?: Record<string, number> };
  const given = p.confidence && Object.keys(p.confidence).length ? Object.values(p.confidence) : null;
  return avg(given ?? Object.values(fieldConfidence(p))) ?? 0;
}
