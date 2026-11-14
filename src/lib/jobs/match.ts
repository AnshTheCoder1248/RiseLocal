import type { BoardFilters } from "@/lib/validation/jobs";
import { distanceMi } from "@/lib/geo";

export type MatchableJob = {
  title: string;
  description: string;
  category: string;
  tags: string[];
  payType: string;
  payMin: number | null;
  payMax: number | null;
  minAge: number;
  schedule: string | null;
  remote: boolean;
  source: string;
  lat: number | null;
  lng: number | null;
  publishedAt: Date | null;
  orgVerified?: boolean;
};

/**
 * In-memory evaluation of a saved watch against a newly published job (WA-6).
 * Mirrors the board filters; `q` uses simple all-terms matching.
 */
export function matchesFilters(job: MatchableJob, f: BoardFilters, studentAge?: number): boolean {
  if (f.category?.length && !f.category.includes(job.category as never)) return false;
  if (f.payType?.length && !f.payType.includes(job.payType as never)) return false;
  if (f.source?.length && !f.source.includes(job.source as never)) return false;
  if (f.schedule?.length && (!job.schedule || !f.schedule.includes(job.schedule as never))) return false;
  if (f.payMin != null && (job.payMax ?? job.payMin ?? 0) < f.payMin) return false;
  if (f.remote && !job.remote) return false;
  if (f.verifiedOnly && !job.orgVerified) return false;
  if (f.eligibleOnly && studentAge != null && job.minAge > studentAge) return false;
  if (f.lat != null && f.lng != null && f.radiusMi != null && !job.remote) {
    if (job.lat == null || job.lng == null) return false;
    if (distanceMi({ lat: f.lat, lng: f.lng }, { lat: job.lat, lng: job.lng }) > f.radiusMi) return false;
  }
  if (f.q) {
    const hay = `${job.title} ${job.description} ${job.tags.join(" ")}`.toLowerCase();
    const terms = f.q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.every((t) => hay.includes(t))) return false;
  }
  return true;
}
