"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { checkContent, type SafetyFlag } from "@/lib/safety/filter";
import { CATEGORIES, SCHEDULES } from "@/lib/validation/jobs";
import { labelize } from "@/lib/jobs/format";

type PayType = "HOURLY" | "FIXED" | "VOLUNTEER";
type FieldErrors = Partial<Record<string, string[]>>;
type Result = { kind: "published" | "held" | "draft" | "saved"; jobId: string; title: string };

const FLAG_HELP: Record<SafetyFlag, string> = {
  pii_phone: "Remove phone numbers. Students message you through RiseLocal.",
  pii_email: "Remove email addresses. Students message you through RiseLocal.",
  off_platform_contact: "Don’t ask people to text, call or DM you. Keep contact on RiseLocal.",
  pii_solicitation: "Don’t ask for addresses, photos or phone numbers.",
  cash_only: "Avoid “cash only” or “under the table”. It gets your post held for review.",
  profanity: "Please keep the language clean.",
  alcohol: "Work involving alcohol can’t be listed for teens.",
  hazardous_machinery: "Work with hazardous machinery can’t be listed for teens.",
  door_to_door: "Door-to-door work can’t be listed for teens.",
  adult_content: "This kind of work can’t be listed for teens.",
  late_hours: "Late-night or overnight hours aren’t a good fit for teens.",
};

const PAY_TYPES: { value: PayType; label: string; hint: string }[] = [
  { value: "HOURLY", label: "Hourly", hint: "Paid per hour" },
  { value: "FIXED", label: "Fixed price", hint: "One amount for the job" },
  { value: "VOLUNTEER", label: "Volunteer", hint: "Unpaid, e.g. service hours" },
];

const selectClass =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive dark:bg-input/30";

function Errors({ list }: { list?: string[] }) {
  return list?.map((e) => <span key={e} className="text-xs text-destructive">{e}</span>);
}

const toCents = (v: string) => (v.trim() === "" ? null : Math.round(Number(v) * 100));

/** Wording for community gigs vs business job postings; the form and API are the same. */
const COPY = {
  gig: {
    noun: "gig", heading: "What do you need help with?", titlePlaceholder: "e.g. Rake leaves in my backyard",
    descPlaceholder: "What’s the work, how long will it take, and is there anything they should bring or know?",
    descHint: "Don’t include phone numbers, emails or your street address. Students contact you through RiseLocal.",
    positions: "How many helpers?", remote: "Can be done remotely (e.g. online tutoring)",
    live: "Your gig is live!", draftBody: "Your gig is saved but not visible to students yet.",
    screened: "Every gig is screened before students see it.", defaultSchedule: "one-time",
  },
  job: {
    noun: "job", heading: "About the job", titlePlaceholder: "e.g. Weekend cashier",
    descPlaceholder: "What will they do, what hours, and what training or perks come with it?",
    descHint: "Don’t include phone numbers or emails. Applicants reach you through RiseLocal.",
    positions: "Openings", remote: "Can be done remotely",
    live: "Your job is live!", draftBody: "Your job is saved as a draft and isn’t visible to students yet.",
    screened: "Every job is screened before students see it.", defaultSchedule: "weekends",
  },
};

/** An existing posting being edited: its id, current status and field values. */
export type EditTarget = {
  id: string;
  status: string;
  values: {
    title: string; description: string; category: string; tags: string[]; payType: PayType; payMin: number | null; payMax: number | null;
    minAge: number; schedule: string | null; remote: boolean; positions: number; startDate: string | null; areaLabel: string;
  };
};

const dollars = (cents: number | null) => (cents == null ? "" : String(cents / 100));

export function PostGigForm({ canPublish, kind = "gig", doneHref, edit }: { canPublish: boolean; kind?: keyof typeof COPY; doneHref?: string; edit?: EditTarget }) {
  const t = COPY[kind];
  const v = edit?.values;
  const isDraft = !edit || edit.status === "DRAFT";
  const [title, setTitle] = useState(v?.title ?? "");
  const [description, setDescription] = useState(v?.description ?? "");
  const [tags, setTags] = useState(v?.tags.join(", ") ?? "");
  const [payType, setPayType] = useState<PayType>(v?.payType ?? "HOURLY");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const tagList = useMemo(() => tags.split(",").map((t) => t.trim()).filter(Boolean).slice(0, 10), [tags]);
  // Same check the server runs at publish time, so problems show up while typing.
  const safety = useMemo(() => checkContent({ title, description, tags: tagList }), [title, description, tagList]);
  const blocked = safety.decision === "reject";

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const publish = (e.nativeEvent as SubmitEvent).submitter?.getAttribute("value") === "publish";
    const form = new FormData(e.currentTarget);
    const get = (k: string) => String(form.get(k) ?? "").trim();

    const local: FieldErrors = {};
    if (title.trim().length < 3) local.title = [`Give your ${t.noun} a title (at least 3 characters)`];
    if (description.trim().length < 10) local.description = ["Describe the work (at least 10 characters)"];
    if (get("areaLabel").length < 2) local.areaLabel = ["Enter a neighborhood or ZIP code"];
    const payMin = payType === "VOLUNTEER" ? null : toCents(get("payMin"));
    const payMax = payType === "VOLUNTEER" ? null : toCents(get("payMax") || get("payMin"));
    if (payType !== "VOLUNTEER") {
      if (payMin == null || !Number.isFinite(payMin) || payMin <= 0) local.payMin = ["Enter how much you’ll pay"];
      else if (payMax != null && (!Number.isFinite(payMax) || payMax < payMin)) local.payMax = ["Max must be at least the min"];
    }
    if (Object.keys(local).length) {
      setErrors(local);
      setError("Please fix the highlighted fields.");
      return;
    }

    const startDate = get("startDate");
    const body = {
      title: title.trim(),
      description: description.trim(),
      category: get("category"),
      tags: tagList,
      payType,
      payMin,
      payMax,
      minAge: Number(get("minAge")),
      schedule: get("schedule") || null,
      remote: form.get("remote") === "on",
      positions: Number(get("positions") || 1),
      startDate: startDate ? new Date(`${startDate}T09:00:00`).toISOString() : null,
      areaLabel: get("areaLabel"),
    };

    setPending(true);
    setErrors({});
    setError(undefined);
    try {
      // New postings are created (and optionally published); edits update in place, and a draft can be published as it's saved.
      const res = edit
        ? await fetch(`/api/jobs/${edit.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, ...(publish && isDraft && { action: "publish" }) }) })
        : await fetch("/api/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, publish }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrors(data.details?.fieldErrors ?? {});
        // A refused publish still leaves the gig saved as a draft (the API creates it first).
        const savedAsDraft = res.status === 422 && publish && !edit;
        setError(`${data.error ?? "Something went wrong. Please try again."}${savedAsDraft ? ` Your ${t.noun} was saved as a draft.` : ""}`);
        return;
      }
      if (edit) {
        const job = data.job as { id: string; title: string; status: string; moderationHold: boolean };
        setResult({ kind: job.moderationHold ? "held" : publish && job.status === "PUBLISHED" ? "published" : "saved", jobId: job.id, title: job.title });
      } else {
        setResult({ kind: !publish ? "draft" : data.publish?.held ? "held" : "published", jobId: data.job.id, title: data.job.title });
      }
    } catch {
      setError("Couldn’t reach RiseLocal. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  if (result) {
    const copy = {
      published: { title: t.live, body: "Students nearby can see it on the job board and apply now." },
      held: { title: `Your ${t.noun} is being reviewed`, body: "Something in your post needs a quick look from our safety team. It goes live once it’s approved." },
      draft: { title: "Saved as a draft", body: t.draftBody },
      saved: { title: "Changes saved", body: isDraft ? t.draftBody : "Students see the updated details now." },
    }[result.kind];
    return (
      <Card>
        <CardHeader>
          <CardTitle>{copy.title}</CardTitle>
          <CardDescription>“{result.title}”. {copy.body}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {(result.kind === "published" || (result.kind === "saved" && !isDraft)) && <Link href={`/jobs/${result.jobId}`} className={buttonVariants()}>View your {t.noun}</Link>}
          {doneHref && <Link href={doneHref} className={buttonVariants({ variant: "outline" })}>{kind === "job" ? "Back to dashboard" : "Go to My jobs"}</Link>}
          {!edit && <Button variant="outline" onClick={() => location.reload()}>Post another {t.noun}</Button>}
        </CardContent>
      </Card>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-6" noValidate>
      <Card>
        <CardHeader>
          <CardTitle>{t.heading}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="title">Title</Label>
            <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder={t.titlePlaceholder} aria-invalid={errors.title ? true : undefined} />
            <Errors list={errors.title} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={5000}
              className="min-h-32"
              placeholder={t.descPlaceholder}
              aria-invalid={errors.description ? true : undefined}
            />
            <span className="text-xs text-muted-foreground">{t.descHint}</span>
            <Errors list={errors.description} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="category">Category</Label>
              <select id="category" name="category" defaultValue={v?.category ?? "other"} className={selectClass}>
                {CATEGORIES.map((c) => <option key={c} value={c}>{labelize(c)}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tags">Tags (optional)</Label>
              <Input id="tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="outdoors, weekends" />
              <span className="text-xs text-muted-foreground">Separate with commas.</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pay</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Pay type">
            {PAY_TYPES.map((p) => (
              <label
                key={p.value}
                className="flex cursor-pointer flex-col gap-0.5 rounded-lg border border-input p-3 text-sm has-checked:border-primary has-checked:bg-muted/50 has-focus-visible:ring-3 has-focus-visible:ring-ring/50"
              >
                <input type="radio" name="payType" value={p.value} checked={payType === p.value} onChange={() => setPayType(p.value)} className="sr-only" />
                <span className="font-medium">{p.label}</span>
                <span className="text-xs text-muted-foreground">{p.hint}</span>
              </label>
            ))}
          </div>
          {payType !== "VOLUNTEER" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="payMin">{payType === "HOURLY" ? "Pay per hour ($)" : "Amount ($)"}</Label>
                <Input id="payMin" name="payMin" type="number" inputMode="decimal" min={0} step="0.5" defaultValue={dollars(v?.payMin ?? null)} placeholder={payType === "HOURLY" ? "15" : "40"} aria-invalid={errors.payMin ? true : undefined} />
                <Errors list={errors.payMin} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="payMax">Up to ($, optional)</Label>
                <Input id="payMax" name="payMax" type="number" inputMode="decimal" min={0} step="0.5" defaultValue={v && v.payMax !== v.payMin ? dollars(v.payMax) : ""} placeholder="Leave blank for a set rate" aria-invalid={errors.payMax ? true : undefined} />
                <Errors list={errors.payMax} />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>When and where</CardTitle>
          <CardDescription>Only share a neighborhood or ZIP code. Your exact address stays private.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="areaLabel">Neighborhood or ZIP</Label>
            <Input id="areaLabel" name="areaLabel" maxLength={80} defaultValue={v?.areaLabel} placeholder="e.g. Maple Grove · 55311" aria-invalid={errors.areaLabel ? true : undefined} />
            <Errors list={errors.areaLabel} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="schedule">Schedule</Label>
            <select id="schedule" name="schedule" defaultValue={v ? (v.schedule ?? "") : t.defaultSchedule} className={selectClass}>
              <option value="">Flexible</option>
              {SCHEDULES.map((s) => <option key={s} value={s}>{labelize(s)}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="startDate">Start date (optional)</Label>
            <Input id="startDate" name="startDate" type="date" defaultValue={v?.startDate?.slice(0, 10)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="minAge">Minimum age</Label>
            <select id="minAge" name="minAge" defaultValue={String(v?.minAge ?? 14)} className={selectClass}>
              {[13, 14, 15, 16, 17, 18].map((a) => <option key={a} value={a}>{a}+</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="positions">{t.positions}</Label>
            <Input id="positions" name="positions" type="number" min={1} max={100} defaultValue={v?.positions ?? 1} />
          </div>
          <label className="flex items-center gap-2 self-end pb-1.5 text-sm">
            <input type="checkbox" name="remote" defaultChecked={v?.remote} className="size-4 accent-primary" />
            {t.remote}
          </label>
        </CardContent>
      </Card>

      {safety.flags.length > 0 && (
        <div
          className={`rounded-lg border px-4 py-3 text-sm ${blocked ? "border-destructive/50 bg-destructive/5" : "border-amber-500/50 bg-amber-500/5"}`}
          role="status"
        >
          <p className="font-medium">{blocked ? `This ${t.noun} can’t be posted for teens` : "Heads up: this will be held for a safety review"}</p>
          <ul className="mt-1 list-disc pl-5 text-muted-foreground">
            {safety.flags.map((f) => <li key={f}>{FLAG_HELP[f]}</li>)}
          </ul>
        </div>
      )}

      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}

      <div className="flex flex-wrap items-center gap-2">
        {edit && !isDraft ? (
          // A live posting: saving re-runs the safety check if the wording changed.
          <Button type="submit" name="intent" value="draft" size="lg" disabled={pending || blocked}>
            {pending ? "Saving…" : "Save changes"}
          </Button>
        ) : (
          <>
            <Button type="submit" name="intent" value="publish" size="lg" disabled={pending || blocked || !canPublish}>
              {pending ? (edit ? "Saving…" : "Posting…") : edit ? "Save and publish" : `Publish ${t.noun}`}
            </Button>
            <Button type="submit" name="intent" value="draft" size="lg" variant="outline" disabled={pending || blocked}>
              {edit ? "Save draft" : "Save as draft"}
            </Button>
          </>
        )}
        <span className="text-xs text-muted-foreground">{t.screened}</span>
      </div>
    </form>
  );
}
