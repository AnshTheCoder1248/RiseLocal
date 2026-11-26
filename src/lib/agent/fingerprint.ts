import { createHash } from "node:crypto";

/** Lowercase, punctuation-free form used for dedupe comparisons (mirrored in SQL by pipeline.ts). */
export const norm = (s?: string | null) => (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Stable dedupe key over normalized title + employer + area (AG-7). */
export function fingerprint(d: { title: string; employer?: string | null; areaLabel?: string | null }) {
  return createHash("sha256").update(`${norm(d.title)}|${norm(d.employer)}|${norm(d.areaLabel)}`).digest("hex").slice(0, 32);
}
