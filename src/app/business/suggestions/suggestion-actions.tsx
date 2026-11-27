"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function SuggestionActions({ id, title, canApprove }: { id: string; title: string; canApprove: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"approve" | "dismiss" | null>(null);

  async function act(action: "approve" | "dismiss") {
    setBusy(action);
    try {
      const res = await fetch(`/api/employer/drafts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Couldn’t update this suggestion. Please try again.");
        return;
      }
      if (action === "dismiss") toast.success(`Dismissed “${title}”`);
      else if (data.held) toast.warning(`“${title}” needs a quick safety review before it goes live`);
      else toast.success(`Published “${title}” as your job`);
      router.refresh();
    } catch {
      toast.error("Couldn’t reach RiseLocal. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex shrink-0 gap-2">
      <Button size="sm" onClick={() => act("approve")} disabled={busy !== null || !canApprove} title={canApprove ? undefined : "Available once your business is verified"}>
        <Check aria-hidden />
        {busy === "approve" ? "Approving…" : "Approve"}
      </Button>
      <Button size="sm" variant="outline" onClick={() => act("dismiss")} disabled={busy !== null}>
        <X aria-hidden />
        {busy === "dismiss" ? "Dismissing…" : "Dismiss"}
      </Button>
    </div>
  );
}
