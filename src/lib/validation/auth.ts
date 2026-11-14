import { z } from "zod";

export const signupSchema = z
  .object({
    role: z.enum(["STUDENT", "EMPLOYER", "COMMUNITY"]),
    email: z.email().transform((e) => e.toLowerCase()),
    password: z.string().min(10, "Use at least 10 characters").max(200),
    displayName: z.string().trim().min(1).max(60),
    dateOfBirth: z.iso.date(),
    guardianEmail: z.email().optional(),
    // Employer-only
    orgName: z.string().trim().min(2).max(120).optional(),
    orgAddress: z.string().trim().max(300).optional(),
  })
  .refine((v) => v.role !== "EMPLOYER" || !!v.orgName, { path: ["orgName"], message: "Business name is required" });

export const guardianTokenSchema = z.object({ token: z.string().min(10).max(2000) });
