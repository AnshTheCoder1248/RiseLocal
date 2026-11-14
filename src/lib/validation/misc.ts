import { z } from "zod";

export const REPORT_REASONS = [
  "pii_solicitation", "unsafe_work", "scam", "inappropriate", "harassment", "underage_rules", "other",
] as const;

export const createReportSchema = z.object({
  targetType: z.enum(["job", "gig", "user", "certificate"]),
  targetId: z.string().min(1).max(64),
  reason: z.enum(REPORT_REASONS),
  details: z.string().trim().max(1000).optional(),
});

export const markNotificationsSchema = z.union([
  z.object({ ids: z.array(z.string()).min(1).max(200) }),
  z.object({ all: z.literal(true) }),
]);

export const issueCertificateSchema = z.object({
  studentId: z.string().min(1),
  roleTitle: z.string().trim().min(2).max(120).optional(),
  startDate: z.iso.datetime(),
  endDate: z.iso.datetime(),
  totalHours: z.number().min(0).max(2000).optional(),
  sessions: z.int().min(0).max(1000).optional(),
  skills: z.array(z.string().trim().max(40)).max(10).default([]),
  note: z.string().trim().max(500).optional(),
  rating: z.int().min(1).max(5).optional(),
  attest: z.literal(true, "You must confirm the student completed this work"),
});

export const updateCertificateSchema = z.union([
  z.object({ visibility: z.enum(["private", "link", "public"]) }),
  z.object({ revoke: z.literal(true), reason: z.string().trim().min(3).max(500) }),
]);

export const profileSchema = z
  .object({
    firstName: z.string().trim().min(1).max(40),
    areaLabel: z.string().trim().max(80),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    availability: z.array(z.string().max(30)).max(10),
    skills: z.array(z.string().max(40)).max(20),
    bio: z.string().trim().max(500),
  })
  .partial();

export const orgVerificationSchema = z.object({
  name: z.string().trim().min(2).max(120),
  address: z.string().trim().min(5).max(300),
  website: z.url().optional(),
});

export const agentSourceSchema = z.object({
  name: z.string().trim().min(2).max(120),
  type: z.enum(["html", "rss", "json_api"]),
  url: z.url(),
  frequency: z.string().regex(/^every \d+h$/, 'Use the form "every 6h"').default("every 6h"),
  hints: z.record(z.string(), z.unknown()).optional(),
  enabled: z.boolean().default(true),
});

export const runAgentSchema = z.object({ sourceId: z.string().min(1) });

export const moderationActionSchema = z.object({
  kind: z.enum(["report", "hold", "verification", "draft"]),
  id: z.string().min(1),
  action: z.enum(["approve", "reject", "escalate", "ban"]),
  reason: z.string().trim().max(500).optional(),
});

export const draftActionSchema = z.object({ action: z.enum(["approve", "dismiss"]) });
