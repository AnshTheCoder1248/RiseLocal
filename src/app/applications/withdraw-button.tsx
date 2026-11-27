"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/** Two-step withdraw: the first click asks for confirmation, since it can't be undone. */
export function WithdrawButton({ applicationId, title }: { applicationId: string; title: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function withdraw() {
    setBusy(true);
    try {
      const res = await fetch(`/api/applications/${applicationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "withdraw" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Couldn’t withdraw this application. Please try again.");
        return;
      }
      toast.success(`Withdrew your application for “${title}”`);
      router.refresh();
    } catch {
      toast.error("Couldn’t reach RiseLocal. Check your connection and try again.");
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  if (!confirming) {
    return (
      <Button variant="outline" size="sm" onClick={() => setConfirming(true)}>
        Withdraw
      </Button>
    );
  }
  return (
    <div className="flex shrink-0 items-center gap-2">
      <span className="text-sm text-muted-foreground">Withdraw?</span>
      <Button variant="destructive" size="sm" onClick={withdraw} disabled={busy}>
        {busy ? "Withdrawing…" : "Yes, withdraw"}
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setConfirming(false)} disabled={busy}>
        Cancel
      </Button>
    </div>
  );
}
