"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Star, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

type Status = "PENDING_GUARDIAN" | "SENT" | "VIEWED" | "SHORTLISTED" | "HIRED" | "DECLINED" | "WITHDRAWN";
type Move = "SHORTLISTED" | "HIRED" | "DECLINED";

const DONE: Record<Move, (name: string) => string> = {
  SHORTLISTED: (n) => `Shortlisted ${n}`,
  HIRED: (n) => `Hired ${n}! They’ve been notified.`,
  DECLINED: (n) => `Let ${n} know they weren’t selected`,
};

/** Shortlist, hire or decline an applicant. Each move notifies the student. */
export function ApplicantActions({ id, name, status }: { id: string; name: string; status: Status }) {
  const router = useRouter();
  const [busy, setBusy] = useState<Move | null>(null);

  if (status === "WITHDRAWN" || status === "PENDING_GUARDIAN") return null;

  async function move(to: Move) {
    setBusy(to);
    try {
      const res = await fetch(`/api/applications/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "move", status: to }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Couldn’t update this applicant. Please try again.");
        return;
      }
      toast.success(DONE[to](name));
      router.refresh();
    } catch {
      toast.error("Couldn’t reach RiseLocal. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  // Offer the next sensible steps for where the applicant is now (moves are reversible).
  const options: Move[] =
    status === "HIRED" ? ["DECLINED"] : status === "DECLINED" ? ["SHORTLISTED"] : status === "SHORTLISTED" ? ["HIRED", "DECLINED"] : ["SHORTLISTED", "HIRED", "DECLINED"];
  const button: Record<Move, { label: string; icon: typeof Check; variant: "default" | "outline" | "ghost" }> = {
    SHORTLISTED: { label: status === "DECLINED" ? "Reconsider" : "Shortlist", icon: Star, variant: "outline" },
    HIRED: { label: "Hire", icon: Check, variant: "default" },
    DECLINED: { label: status === "HIRED" ? "Undo hire" : "Not selected", icon: X, variant: "ghost" },
  };

  return (
    <div className="flex shrink-0 flex-wrap gap-2">
      {options.map((to) => {
        const b = button[to];
        const Icon = b.icon;
        return (
          <Button key={to} size="sm" variant={b.variant} onClick={() => move(to)} disabled={busy !== null}>
            <Icon aria-hidden />
            {busy === to ? "Saving…" : b.label}
          </Button>
        );
      })}
    </div>
  );
}
