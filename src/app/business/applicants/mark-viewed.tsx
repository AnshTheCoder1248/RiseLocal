"use client";

import { useEffect } from "react";

/**
 * Marks new applications as viewed once the business actually sees the page (not on a
 * background prefetch). Each one notifies the student that the poster viewed it.
 */
export function MarkViewed({ ids }: { ids: string[] }) {
  const key = ids.join(",");
  useEffect(() => {
    if (!key) return;
    for (const id of key.split(",")) {
      fetch(`/api/applications/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "move", status: "VIEWED" }),
      }).catch(() => {});
    }
  }, [key]);
  return null;
}
