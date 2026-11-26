import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { extract } from "./extract";
import { classify, type Classification } from "./classify";
import { fingerprint, norm } from "./fingerprint";
import type { JobDraftData, RawItem } from "./schema";

// Stages 2–4 for one discovered item: extract → classify → dedupe & file (AG-6, AG-7, AG-8, AG-9).
// Split in two so the slow network/LLM part (evaluateItem) runs outside any transaction, and
// the writes (fileDrafts) run in the same transaction that checkpoints the item as done
// (see crawler.ts). Drafts are never published here: a verified employer or an admin must
// approve them (human-in-the-loop).

export type SourceHints = { orgId?: string; fieldMap?: Record<string, string> };
type Client = typeof db | Prisma.TransactionClient;

export type ItemEvaluation = {
  found: number;
  rejected: number;
  rejections: { url: string; reason: string }[];
  tokens: number;
  costUsd: number;
  accepted: { draft: JobDraftData; c: Classification }[];
};

export async function evaluateItem(item: RawItem, hints: SourceHints, rejectBelow: number): Promise<ItemEvaluation> {
  const out: ItemEvaluation = { found: 0, rejected: 0, rejections: [], tokens: 0, costUsd: 0, accepted: [] };
  const extracted = await extract(item, hints);
  if (!extracted.ok) {
    out.rejected++;
    out.rejections.push({ url: item.url, reason: `quarantined: ${extracted.reason}` });
    return out;
  }
  out.tokens = extracted.tokens ?? 0;
  out.costUsd = extracted.costUsd ?? 0;
  for (const draft of extracted.drafts) {
    out.found++;
    const c = classify(draft, rejectBelow);
    if (c.reject) {
      out.rejected++;
      out.rejections.push({ url: item.url, reason: c.reason ?? "rejected" });
      continue;
    }
    out.accepted.push({ draft, c });
  }
  return out;
}

async function findOrgId(client: Client, draft: JobDraftData, hints: SourceHints) {
  if (hints.orgId) return hints.orgId;
  if (!draft.employer) return null;
  const org = await client.employerOrg.findFirst({ where: { name: { equals: draft.employer, mode: "insensitive" } }, select: { id: true } });
  return org?.id ?? null;
}

// Near-identical titles only count as the same listing from the same employer: unmatched drafts
// all share orgId = null, so without the employer check "Retail Associate" at one store would
// swallow "Retail Sales Associate" at another in the same town.
async function findFuzzyDuplicate(client: Client, draft: JobDraftData, orgId: string | null) {
  const rows = await client.$queryRaw<{ id: string }[]>`
    SELECT ad.id FROM "AgentDraft" ad JOIN "Job" j ON j.id = ad."jobId"
    WHERE similarity(j.title, ${draft.title}) > 0.6
      AND coalesce(ad."orgId", '') = ${orgId ?? ""}
      AND j."areaLabel" ILIKE ${draft.areaLabel ?? "%"}
      AND trim(regexp_replace(lower(coalesce(ad."rawPayload"->>'employer', '')), '[^a-z0-9]+', ' ', 'g')) = ${norm(draft.employer)}
    LIMIT 1`;
  return rows[0]?.id;
}

async function posterFor(client: Client, orgId: string | null) {
  // Drafts are owned by an org member when matched, else by an admin (admin queue).
  const user = orgId ? await client.user.findFirst({ where: { orgId, role: "EMPLOYER" }, select: { id: true } }) : null;
  return user ?? (await client.user.findFirst({ where: { role: "ADMIN" }, select: { id: true }, orderBy: { createdAt: "asc" } }));
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/**
 * File accepted drafts as AgentDraft + DRAFT Job. Idempotent: a draft whose fingerprint (or a
 * fuzzy match) already exists is refreshed instead of duplicated. Returns how many were created.
 */
export async function fileDrafts(client: Client, accepted: ItemEvaluation["accepted"], ctx: { runId: string; url: string; hints: SourceHints }) {
  let drafted = 0;
  for (const { draft, c } of accepted) {
    const orgId = await findOrgId(client, draft, ctx.hints);
    const fp = fingerprint(draft);
    const rawPayload = draft as unknown as Prisma.InputJsonValue;

    const existing = (await client.agentDraft.findUnique({ where: { fingerprint: fp }, select: { id: true } }))?.id ?? (await findFuzzyDuplicate(client, draft, orgId));
    if (existing) {
      await client.agentDraft.update({ where: { id: existing }, data: { lastSeenAt: new Date(), rawPayload, runId: ctx.runId } });
      continue;
    }

    const poster = await posterFor(client, orgId);
    if (!poster) throw new Error("No admin user exists to own unmatched drafts — seed an ADMIN first");

    await client.agentDraft.create({
      data: {
        run: { connect: { id: ctx.runId } }, orgId, sourceUrl: ctx.url, rawPayload, confidence: avg(Object.values(draft.confidence)), fingerprint: fp,
        job: {
          create: {
            source: "AGENT", status: "DRAFT", title: draft.title, description: draft.description,
            category: draft.category, payType: draft.payType, payMin: draft.payMin, payMax: draft.payMax,
            schedule: draft.schedule, minAge: c.minAge, areaLabel: draft.areaLabel ?? "Unknown area",
            suitability: c.suitability, safetyFlags: c.flags, postedById: poster.id, orgId,
          },
        },
      },
    });
    drafted++;
  }
  return drafted;
}

/** Hours between runs from a cadence like "every 6h". */
export const cadenceHours = (frequency: string) => Number(frequency.match(/(\d+)h/)?.[1] ?? 6);
