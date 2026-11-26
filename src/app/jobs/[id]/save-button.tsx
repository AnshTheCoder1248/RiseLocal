"use client";

import { useState } from "react";
import { Bookmark } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function SaveJobButton({ jobId, initialSaved }: { jobId: string; initialSaved: boolean }) {
  const [saved, setSaved] = useState(initialSaved);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    const next = !saved;
    setBusy(true);
    setSaved(next);
    try {
      const res = await fetch(`/api/jobs/${jobId}/save`, { method: next ? "POST" : "DELETE" });
      if (!res.ok) throw new Error();
      toast.success(next ? "Saved to your jobs" : "Removed from saved jobs");
    } catch {
      setSaved(!next);
      toast.error("Couldn’t update saved jobs. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button variant={saved ? "secondary" : "outline"} size="sm" onClick={toggle} disabled={busy} aria-pressed={saved}>
      <Bookmark className={saved ? "fill-current" : undefined} aria-hidden />
      {saved ? "Saved" : "Save"}
    </Button>
  );
}
