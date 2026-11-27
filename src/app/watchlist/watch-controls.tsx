"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

type Frequency = "instant" | "daily";

const selectClass =
  "h-7 rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 dark:bg-input/30";

/** Instant/daily switch, pause/resume switch and a two-step delete for one watch. */
export function WatchControls({ id, name, active, frequency }: { id: string; name: string; active: boolean; frequency: Frequency }) {
  const router = useRouter();
  const [on, setOn] = useState(active);
  const [freq, setFreq] = useState<Frequency>(frequency);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function setActive(next: boolean) {
    setOn(next);
    setBusy(true);
    try {
      const res = await fetch(`/api/watches/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active: next }) });
      if (!res.ok) throw new Error();
      toast.success(next ? `Alert “${name}” resumed` : `Alert “${name}” paused`);
      router.refresh();
    } catch {
      setOn(!next);
      toast.error("Couldn’t update this alert. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function setFrequency(next: Frequency) {
    const prev = freq;
    setFreq(next);
    setBusy(true);
    try {
      const res = await fetch(`/api/watches/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ frequency: next }) });
      if (!res.ok) throw new Error();
      toast.success(`“${name}” set to ${next === "instant" ? "instant" : "daily"}`);
      router.refresh();
    } catch {
      setFreq(prev);
      toast.error("Couldn’t update this alert. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      const res = await fetch(`/api/watches/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast.success(`Deleted alert “${name}”`);
      router.refresh();
    } catch {
      toast.error("Couldn’t delete this alert. Please try again.");
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-3">
      <select
        value={freq}
        onChange={(e) => setFrequency(e.target.value as Frequency)}
        disabled={busy}
        aria-label={`How often to alert you for ${name}`}
        className={selectClass}
      >
        <option value="instant">Instant</option>
        <option value="daily">Daily</option>
      </select>
      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        <Switch checked={on} onCheckedChange={setActive} disabled={busy} aria-label={on ? `Pause alert ${name}` : `Resume alert ${name}`} />
        {on ? "On" : "Paused"}
      </label>
      {confirming ? (
        <>
          <Button variant="destructive" size="sm" onClick={remove} disabled={busy}>Delete</Button>
          <Button variant="ghost" size="sm" onClick={() => setConfirming(false)} disabled={busy}>Cancel</Button>
        </>
      ) : (
        <Button variant="ghost" size="icon-sm" onClick={() => setConfirming(true)} disabled={busy} aria-label={`Delete alert ${name}`}>
          <Trash2 aria-hidden />
        </Button>
      )}
    </div>
  );
}
