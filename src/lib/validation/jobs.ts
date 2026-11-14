import { z } from "zod";
import { csv, queryBool } from "./common";

export const CATEGORIES = [
  "retail", "food-service", "pet-care", "tutoring", "lawn-mowing", "snow-removal",
  "babysitting", "moving-help", "errands", "office", "camp-counselor", "other",
] as const;
export const SCHEDULES = ["weekends", "after-school", "one-time", "recurring", "seasonal"] as const;

// Base fields carry no defaults so PATCH never silently overwrites omitted fields.
const jobBase = z.object({
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().min(10).max(5000),
  category: z.enum(CATEGORIES),
  tags: z.array(z.string().trim().max(30)).max(10),
  payType: z.enum(["HOURLY", "FIXED", "VOLUNTEER"]),
  payMin: z.int().min(0).max(1_000_000).nullish(), // cents
  payMax: z.int().min(0).max(1_000_000).nullish(),
  minAge: z.int().min(13).max(18),
  schedule: z.enum(SCHEDULES).nullish(),
  remote: z.boolean(),
  positions: z.int().min(1).max(100),
  startDate: z.iso.datetime().nullish(),
  expiresAt: z.iso.datetime().nullish(),
  areaLabel: z.string().trim().min(2).max(80), // neighborhood / ZIP — never a street address
  lat: z.number().min(-90).max(90).nullish(),
  lng: z.number().min(-180).max(180).nullish(),
  locationId: z.string().nullish(),
});

const payRange = (v: { payMin?: number | null; payMax?: number | null }) =>
  v.payMin == null || v.payMax == null || v.payMin <= v.payMax;
const payRangeError = { path: ["payMax"], message: "Max pay must be ≥ min pay" };

export const createJobSchema = jobBase
  .extend({
    tags: jobBase.shape.tags.default([]),
    minAge: jobBase.shape.minAge.default(14),
    remote: jobBase.shape.remote.default(false),
    positions: jobBase.shape.positions.default(1),
    publish: z.boolean().default(false),
  })
  .refine(payRange, payRangeError);

export const updateJobSchema = jobBase
  .partial()
  .extend({ action: z.enum(["publish", "pause", "resume", "fill", "reopen"]).optional() })
  .refine(payRange, payRangeError);

/** Board filters — shared by GET /api/jobs and saved watches (WA-1). */
export const boardFilterSchema = z.object({
  q: z.string().trim().max(200).optional(),
  category: csv(z.enum(CATEGORIES)),
  payType: csv(z.enum(["HOURLY", "FIXED", "VOLUNTEER"])),
  payMin: z.coerce.number().int().min(0).optional(), // cents
  schedule: csv(z.enum(SCHEDULES)),
  remote: queryBool,
  verifiedOnly: queryBool,
  eligibleOnly: queryBool,
  postedWithinDays: z.coerce.number().int().min(1).max(90).optional(),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  radiusMi: z.coerce.number().min(0.5).max(100).optional(),
  source: csv(z.enum(["EMPLOYER", "COMMUNITY", "AGENT"])),
});
export type BoardFilters = z.infer<typeof boardFilterSchema>;

export const boardQuerySchema = boardFilterSchema.extend({
  sort: z.enum(["best", "newest", "nearest", "pay"]).default("best"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});
