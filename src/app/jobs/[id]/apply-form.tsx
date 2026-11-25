"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function ApplyForm({ jobId }: { jobId: string }) {
  const [note, setNote] = useState("");
  const [state, setState] = useState<{ status: "idle" | "sending" | "done" | "error"; message?: string }>({ status: "idle" });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState({ status: "sending" });
    try {
      const res = await fetch(`/api/jobs/${jobId}/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(note.trim() ? { note: note.trim() } : {}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return setState({ status: "error", message: data.error ?? "Something went wrong. Please try again." });
      setState({
        status: "done",
        message: data.guardianApprovalRequired
          ? "Application saved. It will be sent once your guardian approves it."
          : "Application sent! The poster will see your profile and note.",
      });
    } catch {
      setState({ status: "error", message: "Couldn’t reach RiseLocal. Check your connection and try again." });
    }
  }

  if (state.status === "done") return <p className="text-sm font-medium" role="status">{state.message}</p>;

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="note">Note to the poster (optional)</Label>
        <Textarea
          id="note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
          placeholder="Why you’d be great for this job. Don’t include phone numbers, emails or social handles."
        />
        <span className="text-xs text-muted-foreground">{note.length}/500</span>
      </div>
      {state.status === "error" && <p className="text-sm text-destructive" role="alert">{state.message}</p>}
      <Button type="submit" disabled={state.status === "sending"} className="self-start">
        {state.status === "sending" ? "Sending…" : "Apply"}
      </Button>
    </form>
  );
}
