"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

type Kind = "draft" | "hold";

export function ReviewActions({ kind, id, title }: { kind: Kind; id: string; title: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);

  async function act(action: "approve" | "reject") {
    setBusy(action);
    try {
      const res = await fetch("/api/admin/moderation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, id, action }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // e.g. the safety check rejects the job outright.
        toast.error(data.error ?? "Couldn’t update this job. Please try again.");
        return;
      }
      if (action === "reject") toast.success(`Dismissed “${title}”`);
      else if (data.result?.held) toast.warning(`“${title}” was flagged by the safety check and is now on hold`);
      else toast.success(`Published “${title}”`);
      router.refresh();
    } catch {
      toast.error("Couldn’t reach RiseLocal. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex shrink-0 gap-2">
      <Button size="sm" onClick={() => act("approve")} disabled={busy !== null}>
        <Check aria-hidden />
        {busy === "approve" ? "Approving…" : kind === "hold" ? "Publish anyway" : "Approve"}
      </Button>
      <Button size="sm" variant="outline" onClick={() => act("reject")} disabled={busy !== null}>
        <X aria-hidden />
        {busy === "reject" ? "Dismissing…" : kind === "hold" ? "Reject" : "Dismiss"}
      </Button>
    </div>
  );
}
