import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { labelize, postedAgo } from "@/lib/jobs/format";
import { boardFilterSchema, type BoardFilters } from "@/lib/validation/jobs";
import { CreateWatchForm } from "./create-watch-form";
import { WatchControls } from "./watch-controls";

export const metadata: Metadata = { title: "Watchlist — RiseLocal" };

export default function WatchlistPage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-4 py-10 sm:px-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Watchlist</h1>
        <p className="text-muted-foreground">
          Tell us what you’re looking for and we’ll alert you the moment a matching job is posted.
        </p>
      </header>
      <Suspense fallback={<div className="grid gap-3"><Skeleton className="h-64 w-full rounded-xl" /><Skeleton className="h-28 w-full rounded-xl" /></div>}>
        <Watchlist />
      </Suspense>
    </main>
  );
}

const ago = (d: Date) => postedAgo(d)!.replace(/^Posted /, "");

/** Short, human-readable pieces describing what a watch looks for. */
function describe(f: BoardFilters): string[] {
  const parts: string[] = [];
  if (f.q) parts.push(`“${f.q}”`);
  for (const c of f.category ?? []) parts.push(labelize(c));
  for (const s of f.schedule ?? []) parts.push(labelize(s));
  if (f.payMin != null) parts.push(`$${(f.payMin / 100).toFixed(f.payMin % 100 ? 2 : 0)}+/hr`);
  if (f.remote) parts.push("Remote only");
  if (f.eligibleOnly) parts.push("Fits my age");
  return parts.length ? parts : ["Any new job"];
}

type MatchPayload = { watchId?: string; watchName?: string; jobId?: string; title?: string; pay?: string; area?: string };

async function Watchlist() {
  await connection();
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/watchlist");
  if (user.role !== "STUDENT") redirect("/jobs");

  const [watches, matches] = await Promise.all([
    db.watch.findMany({ where: { studentId: user.id }, orderBy: { createdAt: "desc" } }),
    db.notification.findMany({ where: { userId: user.id, kind: "watch_match" }, orderBy: { createdAt: "desc" }, take: 10 }),
  ]);

  return (
    <>
      <CreateWatchForm atLimit={watches.length >= 20} />

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">
          Your alerts <span className="font-normal text-muted-foreground">({watches.length})</span>
        </h2>
        {watches.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>No alerts yet</CardTitle>
              <CardDescription>Create one above, for example “Weekend retail, $15+/hr”.</CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <ul className="grid gap-3">
            {watches.map((w) => {
              const parsed = boardFilterSchema.safeParse(w.filters);
              const parts = parsed.success ? describe(parsed.data) : ["Custom filters"];
              // In-app matches always arrive right away; instant vs daily decides how emails are sent.
              const how = w.channels.includes("email")
                ? `In-app and email · ${w.frequency === "daily" ? "one daily digest email" : "an email per new job"}`
                : `In-app only${w.frequency === "daily" ? " · daily applies to email, which is off" : ""}`;
              return (
                <li key={w.id}>
                  <Card className={w.active ? undefined : "opacity-70"}>
                    <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start">
                      <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <CardTitle className="text-lg">{w.name}</CardTitle>
                        <CardDescription>
                          {how}
                          {w.lastMatchedAt ? ` · last match ${ago(w.lastMatchedAt)}` : " · no matches yet"}
                        </CardDescription>
                      </div>
                      <WatchControls id={w.id} name={w.name} active={w.active} frequency={w.frequency === "daily" ? "daily" : "instant"} />
                    </CardHeader>
                    <CardContent className="flex flex-wrap gap-2">
                      {parts.map((p) => <Badge key={p} variant="outline">{p}</Badge>)}
                      {!w.active && <Badge variant="secondary">Paused</Badge>}
                    </CardContent>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Recent matches</h2>
        {matches.length === 0 ? (
          <p className="text-sm text-muted-foreground">Jobs that match your alerts will show up here.</p>
        ) : (
          <Card>
            <CardContent>
              <ul className="divide-y">
                {matches.map((m) => {
                  const p = (m.payload ?? {}) as MatchPayload;
                  return (
                    <li key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3 text-sm first:pt-0 last:pb-0">
                      {p.jobId ? (
                        <Link href={`/jobs/${p.jobId}`} className="font-medium underline-offset-4 hover:underline">{p.title}</Link>
                      ) : (
                        <span className="font-medium">{p.title}</span>
                      )}
                      <span className="text-muted-foreground">{[p.pay, p.area].filter(Boolean).join(" · ")}</span>
                      <span className="ml-auto text-xs text-muted-foreground">
                        {p.watchName && `${p.watchName} · `}{ago(m.createdAt)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
        )}
      </section>
    </>
  );
}
