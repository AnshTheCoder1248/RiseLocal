"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type Role = "STUDENT" | "EMPLOYER" | "COMMUNITY";
export type FieldErrors = Partial<Record<string, string[]>>;

const ROLES: { value: Role; title: string; body: string }[] = [
  { value: "STUDENT", title: "I’m looking for work", body: "Ages 13–18" },
  { value: "EMPLOYER", title: "I’m hiring for a business", body: "Adults 18+" },
  { value: "COMMUNITY", title: "I have a neighborhood gig", body: "Adults 18+" },
];

/** Age in whole years from a YYYY-MM-DD string, in the viewer's local time. */
export function ageFrom(dob: string) {
  const d = new Date(`${dob}T00:00:00`);
  if (Number.isNaN(d.getTime())) return undefined;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age;
}

export function Field({ id, label, errors, hint, ...input }: { id: string; label: string; errors?: string[]; hint?: string } & React.ComponentProps<"input">) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} name={id} aria-invalid={errors?.length ? true : undefined} {...input} />
      {hint && !errors?.length && <span className="text-xs text-muted-foreground">{hint}</span>}
      {errors?.map((e) => <span key={e} className="text-xs text-destructive">{e}</span>)}
    </div>
  );
}

export function RolePicker({ role, onChange }: { role: Role; onChange: (role: Role) => void }) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-sm font-medium">Who are you?</legend>
      <div className="grid gap-2 sm:grid-cols-3">
        {ROLES.map((r) => (
          <label
            key={r.value}
            className="flex cursor-pointer flex-col gap-0.5 rounded-lg border border-input p-3 text-sm has-checked:border-primary has-checked:bg-muted/50 has-focus-visible:ring-3 has-focus-visible:ring-ring/50"
          >
            <input type="radio" name="role" value={r.value} checked={role === r.value} onChange={() => onChange(r.value)} className="sr-only" />
            <span className="font-medium">{r.title}</span>
            <span className="text-xs text-muted-foreground">{r.body}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Date of birth plus the fields it and the role unlock: guardian email (13–15) or business details. */
export function ProfileFields({ role, dob, onDobChange, errors }: { role: Role; dob: string; onDobChange: (v: string) => void; errors: FieldErrors }) {
  const age = dob ? ageFrom(dob) : undefined;
  const needsGuardian = role === "STUDENT" && age != null && age >= 13 && age < 16;
  return (
    <>
      <Field
        id="dateOfBirth"
        label="Date of birth"
        type="date"
        required
        value={dob}
        onChange={(e) => onDobChange(e.target.value)}
        hint={role === "STUDENT" ? "Used to show jobs that fit your age. Never shown publicly." : "Employer and community accounts are for adults 18+."}
        errors={errors.dateOfBirth}
      />
      {needsGuardian && (
        <Field
          id="guardianEmail"
          label="Parent or guardian email"
          type="email"
          required
          hint="Ages 13–15 need a parent or guardian to approve the account."
          errors={errors.guardianEmail}
        />
      )}
      {role === "EMPLOYER" && (
        <>
          <Field id="orgName" label="Business name" required errors={errors.orgName} />
          <Field id="orgAddress" label="Business address (optional)" hint="Adding an address lets us verify your business." errors={errors.orgAddress} />
        </>
      )}
    </>
  );
}
