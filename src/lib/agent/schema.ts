import { z } from "zod";
import { CATEGORIES, SCHEDULES } from "@/lib/validation/jobs";

/** The strict JobDraft contract Scout's extractor must satisfy (AG-4). */
export const jobDraftSchema = z.object({
  title: z.string().min(3).max(120),
  employer: z.string().min(1).max(120).optional(),
  description: z.string().min(10).max(5000),
  category: z.enum(CATEGORIES).catch("other"),
  payType: z.enum(["HOURLY", "FIXED", "VOLUNTEER"]).catch("HOURLY"),
  payMin: z.number().int().nonnegative().nullish(), // cents
  payMax: z.number().int().nonnegative().nullish(),
  schedule: z.enum(SCHEDULES).nullish().catch(null),
  areaLabel: z.string().max(80).optional(),
  minAge: z.number().int().min(13).max(18).optional(),
  applyUrl: z.url().optional(),
  confidence: z.record(z.string(), z.number().min(0).max(1)).default({}),
});
export type JobDraftData = z.infer<typeof jobDraftSchema>;

export type RawItem = { url: string; text?: string; fields?: Record<string, unknown> };
