"use server";

import { cookies, headers } from "next/headers";
import { z } from "zod";
import { ApiError } from "@/lib/api";
import { GOOGLE_SIGNUP_COOKIE, signIn } from "@/lib/auth/config";
import { registerUser } from "@/lib/auth/signup";
import { clientIp, enforceRateLimit, LIMITS } from "@/lib/rate-limit";
import { verifyToken } from "@/lib/tokens";

/** Start Google sign-up. Existing accounts are simply signed in; new ones land on /signup/google. */
export async function signUpWithGoogle() {
  await signIn("google", { redirectTo: "/jobs" });
}

export type GoogleSignupState =
  | { error?: string; fieldErrors?: Partial<Record<string, string[]>> }
  | { guardianEmail: string }
  | undefined;

const profileSchema = z
  .object({
    role: z.enum(["STUDENT", "EMPLOYER", "COMMUNITY"], { error: "Choose who you are" }),
    displayName: z.string().trim().min(1, "Enter your name").max(60),
    dateOfBirth: z.iso.date({ error: "Enter your date of birth" }),
    guardianEmail: z.email({ error: "Enter a valid email" }).optional(),
    orgName: z.string().trim().min(2, "Enter your business name").max(120).optional(),
    orgAddress: z.string().trim().max(300).optional(),
  })
  .refine((v) => v.role !== "EMPLOYER" || !!v.orgName, { path: ["orgName"], message: "Enter your business name" });

/** Finish Google sign-up: role + date of birth, then create the account linked to Google. */
export async function completeGoogleSignup(_prev: GoogleSignupState, formData: FormData): Promise<GoogleSignupState> {
  const jar = await cookies();
  const identity = verifyToken(jar.get(GOOGLE_SIGNUP_COOKIE)?.value ?? "", "google-signup");
  if (!identity) return { error: "Your Google sign-in expired. Start again with “Sign up with Google”." };

  const value = (k: string) => {
    const v = formData.get(k);
    return typeof v === "string" && v.trim() ? v.trim() : undefined;
  };
  const role = value("role");
  const parsed = profileSchema.safeParse({
    role,
    displayName: value("displayName"),
    dateOfBirth: value("dateOfBirth"),
    guardianEmail: role === "STUDENT" ? value("guardianEmail") : undefined,
    orgName: role === "EMPLOYER" ? value("orgName") : undefined,
    orgAddress: role === "EMPLOYER" ? value("orgAddress") : undefined,
  });
  if (!parsed.success) return { error: "Please fix the highlighted fields.", fieldErrors: z.flattenError(parsed.error).fieldErrors };

  let guardianConsentRequired: boolean;
  try {
    const ip = clientIp(new Request("http://localhost", { headers: await headers() }));
    await enforceRateLimit(LIMITS.signupIp(ip));
    await enforceRateLimit(LIMITS.signupEmail(identity.email));
    ({ guardianConsentRequired } = await registerUser(
      { ...parsed.data, email: identity.email },
      { google: { providerAccountId: identity.providerAccountId, type: identity.type, image: identity.image } },
    ));
  } catch (err) {
    if (err instanceof ApiError) {
      const field = (err.details as { field?: string } | undefined)?.field;
      return field ? { error: "Please fix the highlighted fields.", fieldErrors: { [field]: [err.message] } } : { error: err.message };
    }
    throw err;
  }

  jar.delete(GOOGLE_SIGNUP_COOKIE);
  if (guardianConsentRequired) return { guardianEmail: parsed.data.guardianEmail! };

  // The account is linked to Google now, so this round trip signs straight in (no new prompt
  // while the Google session is live) and lands on the job board.
  await signIn("google", { redirectTo: "/jobs" });
}
