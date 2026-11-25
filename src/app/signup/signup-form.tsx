"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { login } from "../login/actions";
import { ageFrom, Field, ProfileFields, RolePicker, type FieldErrors, type Role } from "./fields";

export function SignupForm({ notice }: { notice?: string }) {
  const [role, setRole] = useState<Role>("STUDENT");
  const [dob, setDob] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>(notice);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [pendingGuardian, setPendingGuardian] = useState<string | null>(null);

  const age = dob ? ageFrom(dob) : undefined;
  const needsGuardian = role === "STUDENT" && age != null && age >= 13 && age < 16;

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const get = (k: string) => String(form.get(k) ?? "").trim() || undefined;
    const body = {
      role,
      displayName: get("displayName"),
      email: get("email"),
      password: String(form.get("password") ?? ""),
      dateOfBirth: get("dateOfBirth"),
      ...(needsGuardian && { guardianEmail: get("guardianEmail") }),
      ...(role === "EMPLOYER" && { orgName: get("orgName"), orgAddress: get("orgAddress") }),
    };

    const required: [keyof typeof body, string][] = [
      ["displayName", "Enter your name"],
      ["email", "Enter your email"],
      ["dateOfBirth", "Enter your date of birth"],
    ];
    if (needsGuardian) required.push(["guardianEmail", "Enter a parent or guardian email"]);
    if (role === "EMPLOYER") required.push(["orgName", "Enter your business name"]);
    const missing: FieldErrors = Object.fromEntries(required.filter(([k]) => !body[k]).map(([k, msg]) => [k, [msg]]));
    if (body.password.length < 10) missing.password = ["Use at least 10 characters"];
    if (Object.keys(missing).length) {
      setFieldErrors(missing);
      setError("Please fix the highlighted fields.");
      return;
    }

    setPending(true);
    setError(undefined);
    setFieldErrors({});
    try {
      const res = await fetch("/api/auth/signup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const fe: FieldErrors = data.details?.fieldErrors ?? {};
        if (data.details?.field) fe[data.details.field] = [data.error];
        setFieldErrors(fe);
        setError(Object.keys(fe).length ? "Please fix the highlighted fields." : data.error ?? "Something went wrong. Please try again.");
        return;
      }
      if (data.guardianConsentRequired) {
        setPendingGuardian(body.guardianEmail ?? "your guardian");
        return;
      }
      // Account is active: sign straight in. On success the action redirects to /jobs.
      const signInData = new FormData();
      signInData.set("email", body.email ?? "");
      signInData.set("password", body.password);
      signInData.set("next", "/jobs");
      const result = await login(undefined, signInData);
      if (result?.error) setError("Your account was created, but signing in failed. Try signing in.");
    } catch (err) {
      // A successful sign-in redirects by throwing; let Next.js handle it.
      if (err && typeof err === "object" && "digest" in err && String(err.digest).startsWith("NEXT_REDIRECT")) throw err;
      setError("Couldn’t reach RiseLocal. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  if (pendingGuardian) return <GuardianPending email={pendingGuardian} />;

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <RolePicker role={role} onChange={setRole} />

      <Field id="displayName" label={role === "STUDENT" ? "Your name" : "Your full name"} autoComplete="name" required errors={fieldErrors.displayName} />
      <Field id="email" label="Email" type="email" autoComplete="email" required errors={fieldErrors.email} />
      <Field id="password" label="Password" type="password" autoComplete="new-password" required minLength={10} hint="At least 10 characters" errors={fieldErrors.password} />
      <ProfileFields role={role} dob={dob} onDobChange={setDob} errors={fieldErrors} />

      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
      <Button type="submit" size="lg" disabled={pending}>{pending ? "Creating account…" : "Create account"}</Button>
    </form>
  );
}

export function GuardianPending({ email }: { email: string }) {
  return (
    <div className="flex flex-col gap-3 text-sm" role="status">
      <p className="font-medium">Almost there! Your account is waiting for approval.</p>
      <p className="text-muted-foreground">
        We sent an approval link to <strong className="text-foreground">{email}</strong>. Once they approve, you can sign in and apply to jobs.
      </p>
      <Link href="/login" className="underline underline-offset-4">Go to sign in</Link>
    </div>
  );
}
