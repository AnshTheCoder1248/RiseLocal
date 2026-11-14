import { z } from "zod";

export const applySchema = z.object({ note: z.string().trim().max(500).optional() });

export const listApplicationsSchema = z.object({ jobId: z.string().optional() });

export const updateApplicationSchema = z.discriminatedUnion("action", [
  // Poster actions
  z.object({ action: z.literal("move"), status: z.enum(["VIEWED", "SHORTLISTED", "HIRED", "DECLINED"]) }),
  // Either side confirms completion (GIG-8, CERT-1)
  z.object({
    action: z.literal("complete"),
    hoursLogged: z.number().min(0).max(2000).optional(),
    rating: z.int().min(1).max(5).optional(),
  }),
  // Student actions
  z.object({ action: z.literal("withdraw") }),
]);
