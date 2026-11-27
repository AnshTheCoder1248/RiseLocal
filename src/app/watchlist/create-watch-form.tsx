"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BellPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { labelize } from "@/lib/jobs/format";
import { CATEGORIES, SCHEDULES } from "@/lib/validation/jobs";

const chip =
  "inline-flex cursor-pointer select-none items-center rounded-full border px-3 py-1 text-sm transition-colors has-[:checked]:border-primary has-[:checked]:bg-primary has-[:checked]:text-primary-foreground has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50 hover:bg-muted has-[:checked]:hover:bg-primary/90";

function Chips({ name, options, selected, onToggle }: { name: string; options: readonly string[]; selected: string[]; onToggle: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <label key={o} className={chip}>
          <input type="checkbox" name={name} value={o} checked={selected.includes(o)} onChange={() => onToggle(o)} className="sr-only" />
          {labelize(o)}
        </label>
      ))}
    </div>
  );
}

const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

export function CreateWatchForm({ atLimit }: { atLimit: boolean }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [categories, setCategories] = useState<string[]>([]);
  const [schedules, setSchedules] = useState<string[]>([]);
  const [remote, setRemote] = useState(false);
  const [eligibleOnly, setEligibleOnly] = useState(true);
  const [email, setEmail] = useState(false);
  const [daily, setDaily] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  function reset() {
    formRef.current?.reset();
    setCategories([]); setSchedules([]); setRemote(false); setEligibleOnly(true); setEmail(false); setDaily(false);
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const q = String(form.get("q") ?? "").trim();
    const pay = String(form.get("payMin") ?? "").trim();
    if (!name) return setError("Give your alert a name.");
    if (pay && (!Number.isFinite(Number(pay)) || Number(pay) < 0)) return setError("Minimum pay must be a number, like 15.");

    const filters = {
      ...(q && { q }),
      ...(categories.length && { category: categories }),
      ...(schedules.length && { schedule: schedules }),
      ...(pay && { payMin: Math.round(Number(pay) * 100) }),
      ...(remote && { remote: true }),
      ...(eligibleOnly && { eligibleOnly: true }),
    };

    setBusy(true);
    setError(undefined);
    try {
      const res = await fetch("/api/watches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, filters, channels: email ? ["in_app", "email"] : ["in_app"], frequency: email && daily ? "daily" : "instant" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return setError(data.error ?? "Couldn’t create the alert. Please try again.");
      toast.success(`Alert “${name}” created`);
      reset();
      router.refresh();
    } catch {
      setError("Couldn’t reach RiseLocal. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>New alert</CardTitle>
        <CardDescription>Pick what matters to you. Leave anything blank to match all jobs.</CardDescription>
      </CardHeader>
      <CardContent>
        <form ref={formRef} onSubmit={submit} className="flex flex-col gap-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="watch-name">Alert name</Label>
              <Input id="watch-name" name="name" maxLength={80} placeholder="e.g. Weekend retail" required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="watch-q">Keywords (optional)</Label>
              <Input id="watch-q" name="q" maxLength={200} placeholder="e.g. cashier, tutoring" />
            </div>
          </div>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-medium">Job types</legend>
            <Chips name="category" options={CATEGORIES} selected={categories} onToggle={(v) => setCategories((l) => toggle(l, v))} />
          </fieldset>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-medium">Schedule</legend>
            <Chips name="schedule" options={SCHEDULES} selected={schedules} onToggle={(v) => setSchedules((l) => toggle(l, v))} />
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="watch-pay">Minimum pay, $/hr (optional)</Label>
              <Input id="watch-pay" name="payMin" type="number" inputMode="decimal" min={0} step="0.5" placeholder="e.g. 15" />
            </div>
            <div className="flex flex-col justify-end gap-2.5 text-sm">
              <label className="flex items-center gap-2">
                <Checkbox checked={eligibleOnly} onCheckedChange={(v) => setEligibleOnly(v === true)} />
                Only jobs I’m old enough for
              </label>
              <label className="flex items-center gap-2">
                <Checkbox checked={remote} onCheckedChange={(v) => setRemote(v === true)} />
                Remote jobs only
              </label>
            </div>
          </div>

          <fieldset className="flex flex-col gap-2.5 text-sm">
            <legend className="mb-2 font-medium">How to alert you</legend>
            <p className="text-muted-foreground">Matches always appear on this page.</p>
            <label className="flex items-center gap-2">
              <Checkbox checked={email} onCheckedChange={(v) => setEmail(v === true)} />
              Also email me
            </label>
            {email && (
              <label className="flex items-center gap-2 pl-6">
                <Checkbox checked={daily} onCheckedChange={(v) => setDaily(v === true)} />
                Send one daily digest instead of an email per job
              </label>
            )}
          </fieldset>

          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          {atLimit && <p className="text-sm text-muted-foreground">You have 20 alerts, the most allowed. Delete one to add another.</p>}
          <Button type="submit" disabled={busy || atLimit} className="self-start">
            <BellPlus aria-hidden />
            {busy ? "Creating…" : "Create alert"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
