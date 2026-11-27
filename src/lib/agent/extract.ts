import { env } from "@/lib/env";
import { fieldConfidence } from "./confidence";
import { jobDraftSchema, type JobDraftData, type RawItem } from "./schema";

// Stage 2 — Extract (AG-4). Structured items (json_api with a field map) are mapped
// directly; free text goes through the LLM, validated against jobDraftSchema with
// one repair pass, then quarantined if still invalid. Never silently dropped.

export type ExtractResult =
  | { ok: true; drafts: JobDraftData[]; tokens?: number; costUsd?: number }
  | { ok: false; reason: string };

/**
 * LLM extraction hook. Wire your provider here (P4): send `text` with the versioned
 * prompt `env().AGENT_PROMPT_VERSION`, ask for a JSON array matching jobDraftSchema,
 * and return the parsed JSON plus token/cost usage.
 */
export async function llmExtract(_text: string, _opts: { repairOf?: string } = {}): Promise<{ json: unknown; tokens?: number; costUsd?: number }> {
  if (!env().LLM_API_KEY) throw new Error("LLM extraction not configured (set LLM_API_KEY and implement llmExtract)");
  throw new Error("llmExtract is not implemented yet — see src/lib/agent/extract.ts");
}

function mapFields(fields: Record<string, unknown>, fieldMap: Record<string, string> = {}) {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(jobDraftSchema.shape)) out[key] = fields[fieldMap[key] ?? key];
  return out;
}

export async function extract(item: RawItem, hints: { fieldMap?: Record<string, string> } = {}): Promise<ExtractResult> {
  if (item.fields && !item.text) {
    const parsed = jobDraftSchema.safeParse({ ...mapFields(item.fields, hints.fieldMap), applyUrl: item.url });
    if (!parsed.success) return { ok: false, reason: `field map invalid: ${parsed.error.issues[0]?.message}` };
    // Feeds rarely send confidences; score each key field by whether the listing provides it.
    const draft = Object.keys(parsed.data.confidence).length ? parsed.data : { ...parsed.data, confidence: fieldConfidence(parsed.data) };
    return { ok: true, drafts: [draft] };
  }

  try {
    let { json, tokens, costUsd } = await llmExtract(item.text ?? "");
    let parsed = jobDraftSchema.array().safeParse(json);
    if (!parsed.success) {
      const repair = await llmExtract(item.text ?? "", { repairOf: JSON.stringify(parsed.error.issues).slice(0, 2000) });
      json = repair.json;
      tokens = (tokens ?? 0) + (repair.tokens ?? 0);
      costUsd = (costUsd ?? 0) + (repair.costUsd ?? 0);
      parsed = jobDraftSchema.array().safeParse(json);
    }
    return parsed.success ? { ok: true, drafts: parsed.data, tokens, costUsd } : { ok: false, reason: "invalid after repair pass" };
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }
}
