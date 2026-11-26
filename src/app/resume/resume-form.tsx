"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileText } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatBytes, RESUME_ACCEPT, resumeFileError } from "@/lib/resume";

type Current = { fileName: string; size: number; uploadedAt: string } | null;

export function ResumeForm({ current }: { current: Current }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<"upload" | "delete" | null>(null);
  const [message, setMessage] = useState<{ kind: "error" | "ok"; text: string } | null>(null);

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return setMessage({ kind: "error", text: "Choose a file first." });
    const error = resumeFileError(file);
    if (error) return setMessage({ kind: "error", text: error });
    setBusy("upload");
    setMessage(null);
    try {
      const body = new FormData();
      body.set("file", file);
      const res = await fetch("/api/resume", { method: "POST", body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return setMessage({ kind: "error", text: data.error ?? "Upload failed. Please try again." });
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
      setMessage({ kind: "ok", text: "Resume uploaded." });
      router.refresh();
    } catch {
      setMessage({ kind: "error", text: "Couldn’t reach RiseLocal. Check your connection and try again." });
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    setBusy("delete");
    setMessage(null);
    try {
      const res = await fetch("/api/resume", { method: "DELETE" });
      if (!res.ok) return setMessage({ kind: "error", text: "Couldn’t remove your resume. Please try again." });
      setMessage({ kind: "ok", text: "Resume removed." });
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{current ? "Your resume" : "Upload your resume"}</CardTitle>
        <CardDescription>PDF or Word document, up to 2 MB.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {current && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2">
            <FileText className="size-5 text-muted-foreground" aria-hidden />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm font-medium">{current.fileName}</span>
              <span className="text-xs text-muted-foreground">
                {formatBytes(current.size)} · uploaded {new Date(current.uploadedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
              </span>
            </div>
            <a href="/api/resume" target="_blank" rel="noopener" className={buttonVariants({ variant: "outline", size: "sm" })}>View</a>
            <Button variant="ghost" size="sm" onClick={remove} disabled={busy !== null}>
              {busy === "delete" ? "Removing…" : "Remove"}
            </Button>
          </div>
        )}

        <form onSubmit={upload} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="resume-file">{current ? "Replace with a new file" : "Choose a file"}</Label>
            <Input
              id="resume-file"
              ref={inputRef}
              type="file"
              accept={RESUME_ACCEPT}
              onChange={(e) => { setFile(e.target.files?.[0] ?? null); setMessage(null); }}
            />
          </div>
          {message && (
            <p className={message.kind === "error" ? "text-sm text-destructive" : "text-sm font-medium"} role={message.kind === "error" ? "alert" : "status"}>
              {message.text}
            </p>
          )}
          <Button type="submit" disabled={!file || busy !== null} className="self-start">
            {busy === "upload" ? "Uploading…" : current ? "Replace resume" : "Upload resume"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
