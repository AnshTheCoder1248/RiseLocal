import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { conflict, unprocessable } from "@/lib/api";
import { ageOn, MIN_AGE, needsGuardian } from "./age";
import { createToken, days } from "@/lib/tokens";
import { emailGuardian } from "@/lib/notifications";
import { kickOutbox } from "@/lib/outbox";
import type { Role } from "@/generated/prisma/client";

export type SignupProfile = {
  role: Role & ("STUDENT" | "EMPLOYER" | "COMMUNITY");
  email: string; // lowercased
  displayName: string;
  dateOfBirth: string; // YYYY-MM-DD
  guardianEmail?: string;
  orgName?: string;
  orgAddress?: string;
};

/** How the new account signs in: a password, or a verified Google identity. */
export type SignupCredential = { passwordHash: string } | { google: { providerAccountId: string; type: string; image?: string } };

/**
 * Age gate (AUTH-2), role rules, guardian flow (AUTH-3) and account creation, shared by
 * email sign-up (POST /api/auth/signup) and Google sign-up (/signup/google).
 * Throws ApiError on any rule violation. Nothing is stored for under-13s.
 */
export async function registerUser(input: SignupProfile, credential: SignupCredential) {
  const dob = new Date(input.dateOfBirth);
  const age = ageOn(dob);
  if (age < MIN_AGE) {
    throw unprocessable("RiseLocal is for teens 13 and older. Come back when you turn 13!", { reason: "under_13" });
  }
  if (input.role === "STUDENT" && age > 18) throw unprocessable("Student accounts are for ages 13–18.");
  if (input.role !== "STUDENT" && age < 18) throw unprocessable("Employer and community accounts are for adults 18+.");

  const guardianRequired = input.role === "STUDENT" && needsGuardian(age);
  if (guardianRequired && !input.guardianEmail) throw unprocessable("A parent or guardian email is required for ages 13–15.", { field: "guardianEmail" });
  if (input.guardianEmail && input.guardianEmail.toLowerCase() === input.email) throw unprocessable("Guardian email must be different from yours.", { field: "guardianEmail" });
  if (input.role === "EMPLOYER" && !input.orgName) throw unprocessable("Business name is required", { field: "orgName" });

  if (await db.user.findUnique({ where: { email: input.email }, select: { id: true } })) throw conflict("An account with this email already exists");

  // The account and the guardian consent email commit together (transactional outbox).
  const user = await db.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        role: input.role,
        email: input.email,
        ...("passwordHash" in credential
          ? { passwordHash: credential.passwordHash }
          : {
              emailVerified: new Date(), // Google only admits verified emails
              image: credential.google.image,
              accounts: { create: { provider: "google", type: credential.google.type, providerAccountId: credential.google.providerAccountId } },
            }),
        displayName: input.displayName,
        dateOfBirth: dob,
        isMinor: age < 18,
        // TODO(P1): require email verification before ACTIVE for adults (AUTH-4).
        status: guardianRequired ? "PENDING" : "ACTIVE",
        ...(input.role === "STUDENT" && {
          studentProfile: { create: { firstName: input.displayName.split(/\s+/)[0], availability: [], skills: [] } },
        }),
        ...(input.guardianEmail && { guardian: { create: { email: input.guardianEmail.toLowerCase() } } }),
        ...(input.role === "EMPLOYER" && {
          employerOrg: { create: { name: input.orgName!, address: input.orgAddress, verificationStatus: input.orgAddress ? "PENDING" : "UNVERIFIED" } },
        }),
      },
      select: { id: true, role: true, status: true, email: true, displayName: true, isMinor: true },
    });

    if (guardianRequired) {
      const token = createToken({ kind: "guardian-consent", studentId: created.id, email: input.guardianEmail!.toLowerCase(), exp: days(7) });
      await emailGuardian(
        input.guardianEmail!,
        `${created.displayName} wants to join RiseLocal`,
        `${created.displayName} signed up for RiseLocal, a safe job board for teens. Their account stays paused until you approve it.\n\nApprove: ${env().APP_URL}/guardian/consent?token=${token}\n\nThis link expires in 7 days.`,
        { idempotencyKey: `guardian-consent:${created.id}`, tx },
      );
    }
    return created;
  });
  if (guardianRequired) await kickOutbox();

  return { user, guardianConsentRequired: guardianRequired };
}
