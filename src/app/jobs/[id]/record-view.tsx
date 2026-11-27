"use client";

import { useEffect } from "react";

/** Counts one view of this job per browser session, once the page is actually on screen. */
export function RecordView({ jobId }: { jobId: string }) {
  useEffect(() => {
    const key = `viewed-job:${jobId}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch {
      // Storage can be unavailable (private mode); the server still limits repeat counting.
    }
    fetch(`/api/jobs/${jobId}/view`, { method: "POST", keepalive: true }).catch(() => {});
  }, [jobId]);
  return null;
}
