"use server";

import { AuthError, CredentialsSignin } from "next-auth";
import { signIn, signOut } from "@/lib/auth/config";
import { safeNext } from "@/lib/jobs/format";

export type LoginState = { error?: string } | undefined;

export async function logout() {
  await signOut({ redirectTo: "/" });
}

/** With no `next`, sign-in goes to "/", where the proxy sends each role to its own home page. */

/** Google sign-in. Redirects to Google; the signIn callback only admits existing accounts. */
export async function loginWithGoogle(formData: FormData) {
  await signIn("google", { redirectTo: safeNext(formData.get("next"), "/") });
}

/** Credentials sign-in. On success Auth.js redirects (a thrown redirect, so it's rethrown). */
export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  try {
    await signIn("credentials", {
      email: String(formData.get("email") ?? ""),
      password: String(formData.get("password") ?? ""),
      redirectTo: safeNext(formData.get("next"), "/"),
    });
  } catch (err) {
    if (err instanceof CredentialsSignin && err.code === "rate_limited") {
      return { error: "Too many sign-in attempts. Wait a few minutes and try again." };
    }
    if (err instanceof AuthError) return { error: "Email or password is incorrect." };
    throw err;
  }
}
