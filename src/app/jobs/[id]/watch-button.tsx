"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import type { BoardFilters } from "@/lib/validation/jobs";

type Frequency = "instant" | "daily";

const selectClass =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

/**
 * Watch: saves an alert for jobs like this one. Watches started here also email the student,
 * either per job (instant) or as one daily digest, so the choice changes what they receive.
 */
export function WatchJobButton({ name, filters, watching }: { name: string; filters: BoardFilters; watching: Frequency | null }) {
  const [current, setCurrent] = useState<Frequency | null>(watching);
  const [open, setOpen] = useState(false);
  const [frequency, setFrequency] = useState<Frequency>("instant");
  const [busy, setBusy] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const selectId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onClick = (e: MouseEvent) => panelRef.current && !panelRef.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  async function startWatching() {
    setBusy(true);
    try {
      const res = await fetch("/api/watches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, filters, channels: ["in_app", "email"], frequency }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Couldn’t start watching. Please try again.");
        return;
      }
      setCurrent(frequency);
      setOpen(false);
      toast.success(frequency === "instant" ? "Watching. We’ll alert you as soon as a similar job is posted." : "Watching. You’ll get one daily digest of similar jobs.");
    } catch {
      toast.error("Couldn’t reach RiseLocal. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (current) {
    return (
      <Link href="/watchlist" className={buttonVariants({ variant: "secondary", size: "sm" })} title="Manage this alert in your watchlist">
        <Eye aria-hidden />
        Watching · {current === "instant" ? "Instant" : "Daily"}
      </Link>
    );
  }

  return (
    <div ref={panelRef} className="relative">
      <Button variant="outline" size="sm" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="dialog">
        {open ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
        Watch
      </Button>
      {open && (
        <div
          role="dialog"
          aria-label="Watch for jobs like this"
          className="absolute right-0 top-full z-20 mt-2 flex w-72 flex-col gap-3 rounded-xl border bg-popover p-4 text-popover-foreground shadow-lg"
        >
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium">Watch for jobs like this</span>
            <span className="text-xs text-muted-foreground">Same type of job, near this one, that you’re old enough for.</span>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={selectId} className="text-sm">Alert me</label>
            <select id={selectId} value={frequency} onChange={(e) => setFrequency(e.target.value as Frequency)} className={selectClass}>
              <option value="instant">Instant</option>
              <option value="daily">Daily</option>
            </select>
          </div>
          <p className="rounded-lg bg-muted/60 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
            When a new job matches a watch, you’re notified within minutes. Toggle each one instant or daily in the{" "}
            <Link href="/watchlist" className="font-medium text-foreground underline underline-offset-4">Watchlist</Link> tab.
          </p>
          <div className="flex gap-2">
            <Button size="sm" onClick={startWatching} disabled={busy}>
              {busy ? "Saving…" : "Start watching"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
