"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

type Choice = "fill" | "delete";

const PANEL_HEIGHT = 320; // roomy estimate of the panel's height, for deciding which way it opens

/**
 * Remove a job from the board: "Positions filled" keeps it on record and tells waiting
 * applicants it's filled; "Delete listing" archives it and tells them it's closed.
 */
export function JobRowActions({ id, title, published, openApplicants }: { id: string; title: string; published: boolean; openApplicants: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<Choice>(published ? "fill" : "delete");
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  // The panel is fixed to the viewport so the jobs table's horizontal scroll can't clip it.
  const [pos, setPos] = useState<{ top?: number; bottom?: number; right: number }>();

  function place() {
    const r = buttonRef.current?.getBoundingClientRect();
    if (!r) return;
    const right = Math.max(8, window.innerWidth - r.right);
    // Open upward when there isn't room for the panel below the button.
    setPos(window.innerHeight - r.bottom < PANEL_HEIGHT ? { bottom: window.innerHeight - r.top + 4, right } : { top: r.bottom + 4, right });
  }

  function toggle() {
    place();
    setOpen((o) => !o);
  }

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    const onClick = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && close();
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    // Keep the panel next to its button while the page or table scrolls.
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  async function confirm() {
    setBusy(true);
    try {
      const res =
        choice === "fill"
          ? await fetch(`/api/jobs/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "fill" }) })
          : await fetch(`/api/jobs/${id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Couldn’t update this job. Please try again.");
        return;
      }
      toast.success(choice === "fill" ? `Marked “${title}” as filled` : `Deleted “${title}”`);
      setOpen(false);
      router.refresh();
    } catch {
      toast.error("Couldn’t reach RiseLocal. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const waiting =
    openApplicants === 0
      ? null
      : `${openApplicants} applicant${openApplicants === 1 ? " is" : "s are"} still waiting and will be told ${choice === "fill" ? "the job has been filled" : "it’s no longer accepting applications"}.`;

  return (
    <div ref={ref} className="inline-block">
      <Button ref={buttonRef} variant="ghost" size="sm" onClick={toggle} aria-expanded={open} aria-haspopup="dialog">
        Remove
      </Button>
      {open && (
        <div
          role="dialog"
          aria-label={`Remove ${title}`}
          style={pos}
          className="fixed z-50 flex w-80 max-w-[calc(100vw-16px)] flex-col gap-3 rounded-xl border bg-popover p-4 text-left text-popover-foreground shadow-lg"
        >
          <span className="text-sm font-medium">Take “{title}” off the job board?</span>
          <fieldset className="flex flex-col gap-2">
            <legend className="sr-only">Why are you removing it?</legend>
            {published && (
              <label className="flex cursor-pointer gap-2 rounded-lg border p-2.5 text-sm has-checked:border-primary has-checked:bg-muted/50">
                <input type="radio" name={`remove-${id}`} checked={choice === "fill"} onChange={() => setChoice("fill")} className="mt-0.5 accent-primary" />
                <span className="flex flex-col gap-0.5">
                  <span className="flex items-center gap-1.5 font-medium"><CheckCircle2 className="size-3.5" aria-hidden />Positions filled</span>
                  <span className="text-xs text-muted-foreground">You hired who you needed. It stays in your records.</span>
                </span>
              </label>
            )}
            <label className="flex cursor-pointer gap-2 rounded-lg border p-2.5 text-sm has-checked:border-primary has-checked:bg-muted/50">
              <input type="radio" name={`remove-${id}`} checked={choice === "delete"} onChange={() => setChoice("delete")} className="mt-0.5 accent-primary" />
              <span className="flex flex-col gap-0.5">
                <span className="flex items-center gap-1.5 font-medium"><Trash2 className="size-3.5" aria-hidden />Delete listing</span>
                <span className="text-xs text-muted-foreground">You no longer want to post it.</span>
              </span>
            </label>
          </fieldset>
          {waiting && <p className="rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">{waiting}</p>}
          <div className="flex gap-2">
            <Button size="sm" variant={choice === "delete" ? "destructive" : "default"} onClick={confirm} disabled={busy}>
              {busy ? "Saving…" : choice === "fill" ? "Mark as filled" : "Delete listing"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  );
}
