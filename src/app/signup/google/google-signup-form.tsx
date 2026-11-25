"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { completeGoogleSignup } from "../actions";
import { Field, ProfileFields, RolePicker, type Role } from "../fields";
import { GuardianPending } from "../signup-form";

export function GoogleSignupForm({ name, email }: { name: string; email: string }) {
  const [state, action, pending] = useActionState(completeGoogleSignup, undefined);
  const [role, setRole] = useState<Role>("STUDENT");
  const [dob, setDob] = useState("");

  if (state && "guardianEmail" in state) return <GuardianPending email={state.guardianEmail} />;
  const errors = state?.fieldErrors ?? {};

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <p className="rounded-lg bg-muted/50 px-3 py-2 text-sm">
        Signed in with Google as <strong>{email}</strong>
      </p>
      <RolePicker role={role} onChange={setRole} />
      <Field id="displayName" label={role === "STUDENT" ? "Your name" : "Your full name"} defaultValue={name} autoComplete="name" required errors={errors.displayName} />
      <ProfileFields role={role} dob={dob} onDobChange={setDob} errors={errors} />
      {state?.error && <p className="text-sm text-destructive" role="alert">{state.error}</p>}
      <Button type="submit" size="lg" disabled={pending}>{pending ? "Creating account…" : "Create account"}</Button>
    </form>
  );
}
