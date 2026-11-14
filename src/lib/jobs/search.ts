import { db } from "@/lib/db";
import { boundingBox, distanceMi } from "@/lib/geo";
import { publicJobWhere } from "@/lib/safety/gate";
import type { Prisma } from "@/generated/prisma/client";
import type { z } from "zod";
import type { boardQuerySchema } from "@/lib/validation/jobs";

type BoardQuery = z.infer<typeof boardQuerySchema>;

const MAX_GEO_CANDIDATES = 500;

/** IDs matching a full-text query, with trigram fallback for typos (BR-3). Ranked best-first. */
async function searchIds(q: string): Promise<string[]> {
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Job"
    WHERE status = 'PUBLISHED'
      AND (search_vector @@ websearch_to_tsquery('english', ${q}) OR word_similarity(${q}, title) >= 0.45)
    ORDER BY ts_rank(search_vector, websearch_to_tsquery('english', ${q})) + word_similarity(${q}, title) DESC
    LIMIT 1000`;
  return rows.map((r) => r.id);
}

export const publicJobSelect = {
  id: true, source: true, status: true, title: true, description: true, category: true, tags: true,
  payType: true, payMin: true, payMax: true, minAge: true, schedule: true, remote: true, positions: true,
  startDate: true, areaLabel: true, lat: true, lng: true, publishedAt: true, expiresAt: true,
  org: { select: { id: true, name: true, verified: true } },
  postedBy: { select: { id: true, displayName: true, createdAt: true } },
} satisfies Prisma.JobSelect;

export async function searchBoard(query: BoardQuery, viewer?: { age?: number }) {
  const where: Prisma.JobWhereInput = { AND: [publicJobWhere()] };
  const and = where.AND as Prisma.JobWhereInput[];

  if (query.category?.length) and.push({ category: { in: query.category } });
  if (query.payType?.length) and.push({ payType: { in: query.payType } });
  if (query.schedule?.length) and.push({ schedule: { in: query.schedule } });
  if (query.source?.length) and.push({ source: { in: query.source } });
  if (query.payMin != null) and.push({ OR: [{ payMax: { gte: query.payMin } }, { payMax: null, payMin: { gte: query.payMin } }] });
  if (query.remote) and.push({ remote: true });
  if (query.verifiedOnly) and.push({ org: { verified: true } });
  if (query.eligibleOnly && viewer?.age != null) and.push({ minAge: { lte: viewer.age } });
  if (query.postedWithinDays) and.push({ publishedAt: { gte: new Date(Date.now() - query.postedWithinDays * 864e5) } });

  let rankedIds: string[] | undefined;
  if (query.q) {
    rankedIds = await searchIds(query.q);
    and.push({ id: { in: rankedIds } });
  }

  const center = query.lat != null && query.lng != null ? { lat: query.lat, lng: query.lng } : undefined;
  if (center && query.radiusMi) {
    const box = boundingBox(center, query.radiusMi);
    and.push({ OR: [{ remote: true }, { lat: { gte: box.minLat, lte: box.maxLat }, lng: { gte: box.minLng, lte: box.maxLng } }] });
  }

  const skip = (query.page - 1) * query.pageSize;
  const needsInMemorySort = query.sort === "nearest" || (query.sort === "best" && rankedIds) || (center && query.radiusMi);

  const withDistance = <T extends { lat: number | null; lng: number | null; remote: boolean }>(j: T) => ({
    ...j,
    distanceMi: center && j.lat != null && j.lng != null ? Math.round(distanceMi(center, { lat: j.lat, lng: j.lng }) * 10) / 10 : null,
  });

  if (!needsInMemorySort) {
    const orderBy: Prisma.JobOrderByWithRelationInput[] =
      query.sort === "pay" ? [{ payMax: { sort: "desc", nulls: "last" } }, { publishedAt: "desc" }] : [{ publishedAt: "desc" }];
    const [total, items] = await Promise.all([
      db.job.count({ where }),
      db.job.findMany({ where, orderBy, skip, take: query.pageSize, select: publicJobSelect }),
    ]);
    return { total, page: query.page, pageSize: query.pageSize, items: items.map(withDistance) };
  }

  // Geo radius / nearest / relevance sorts: fetch a bounded candidate set and sort in memory.
  const candidates = (await db.job.findMany({ where, take: MAX_GEO_CANDIDATES, select: publicJobSelect })).map(withDistance);
  const filtered = candidates.filter((j) => !query.radiusMi || j.remote || (j.distanceMi != null && j.distanceMi <= query.radiusMi));
  if (query.sort === "nearest") filtered.sort((a, b) => (a.distanceMi ?? Infinity) - (b.distanceMi ?? Infinity));
  else if (query.sort === "pay") filtered.sort((a, b) => (b.payMax ?? b.payMin ?? 0) - (a.payMax ?? a.payMin ?? 0));
  else if (query.sort === "newest") filtered.sort((a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0));
  else if (rankedIds) {
    const rank = new Map(rankedIds.map((id, i) => [id, i]));
    filtered.sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
  }
  return { total: filtered.length, page: query.page, pageSize: query.pageSize, items: filtered.slice(skip, skip + query.pageSize) };
}

/** Annotate jobs with eligibility hints for the viewing student (BR-5). */
export function withEligibility<T extends { minAge: number }>(items: T[], age?: number) {
  return items.map((j) => ({
    ...j,
    eligible: age == null || j.minAge <= age,
    ineligibleReason: age != null && j.minAge > age ? `Ages ${j.minAge}+ — not eligible yet` : null,
  }));
}
