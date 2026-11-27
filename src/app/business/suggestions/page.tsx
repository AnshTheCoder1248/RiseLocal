import { connection } from "next/server";
import { Suspense } from "react";
import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { db } from "@/lib/db";
import { draftConfidence, NEEDS_REVIEW_BELOW } from "@/lib/agent/confidence";
import { formatPay, labelize, postedAgo } from "@/lib/jobs/format";
import { requireBusiness } from "../business-user";
import { SuggestionActions } from "./suggestion-actions";

export const metadata: Metadata = { title: "Scout suggestions — RiseLocal" };

export default function SuggestionsPage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-4 py-10 sm:px-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Scout suggestions</h1>
        <p className="text-muted-foreground">
          Openings Scout found for your business online. Approve one to publish it as your job, or dismiss it.
        </p>
      </header>
      <Suspense fallback={<div className="grid gap-3">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-48 w-full rounded-xl" />)}</div>}>
        <Suggestions />
      </Suspense>
    </main>
  );
}

const ago = (d: Date) => postedAgo(d)!.replace(/^Posted /, "");

async function Suggestions() {
  await connection();
  const { org } = await requireBusiness("/business/suggestions");

  const drafts = org
    ? await db.agentDraft.findMany({ where: { orgId: org.id, reviewState: "pending", job: { isNot: null } }, include: { job: true }, orderBy: { createdAt: "desc" } })
    : [];
  // Least certain first, so the ones that need a careful look come up top.
  const items = drafts
    .map((d) => ({ ...d, score: draftConfidence(d.confidence, d.rawPayload) }))
    .sort((a, b) => a.score - b.score);

  return (
    <>
      {org && !org.verified && (
        <p className="rounded-lg border border-amber-500/50 bg-amber-500/5 px-4 py-3 text-sm">
          <span className="font-medium">Approving is locked until your business is verified.</span>{" "}
          <span className="text-muted-foreground">You can still dismiss suggestions that aren’t yours. Scout only publishes openings for verified businesses, so nobody can post jobs in your name.</span>
        </p>
      )}

      {items.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No suggestions right now</CardTitle>
            <CardDescription>
              When Scout finds an opening listed under “{org?.name ?? "your business"}”, it shows up here for you to approve or dismiss.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <ul className="grid gap-3">
          {items.map((d) => {
            const job = d.job!;
            const pct = Math.round(d.score * 100);
            const low = d.score < NEEDS_REVIEW_BELOW;
            const raw = (d.rawPayload ?? {}) as { applyUrl?: string; minAge?: number | null };
            const link = raw.applyUrl ?? d.sourceUrl;
            const facts: [string, string][] = [
              ["Wage", formatPay(job)],
              // With no age in the listing, the safety check sets one; say so rather than imply the listing did.
              ["Minimum age", raw.minAge == null ? `${job.minAge}+ (not stated)` : `${job.minAge}+`],
              ["Schedule", job.schedule ? labelize(job.schedule) : "Not stated"],
              ["Location", job.remote ? "Remote" : job.areaLabel],
              ["Category", labelize(job.category)],
              ["Openings", String(job.positions)],
            ];
            return (
              <li key={d.id}>
                <Card className={low ? "border-amber-500/50" : undefined}>
                  <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start">
                    <div className="flex min-w-0 flex-1 flex-col gap-2">
                      <CardTitle className="text-lg">{job.title}</CardTitle>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={low ? "outline" : "secondary"}>{pct}% confidence</Badge>
                        {low && <Badge className="bg-amber-500 text-white hover:bg-amber-500">Needs review</Badge>}
                        {job.safetyFlags.map((f) => <Badge key={f} variant="destructive">{labelize(f)}</Badge>)}
                      </div>
                    </div>
                    <SuggestionActions id={d.id} title={job.title} canApprove={!!org?.verified} />
                  </CardHeader>
                  <CardContent className="flex flex-col gap-4 text-sm">
                    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
                      {facts.map(([k, v]) => (
                        <div key={k}>
                          <dt className="text-muted-foreground">{k}</dt>
                          <dd className="font-medium">{v}</dd>
                        </div>
                      ))}
                    </dl>
                    <p className="line-clamp-3 leading-relaxed text-muted-foreground">{job.description}</p>
                    {low && (
                      <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs">
                        Scout couldn’t confirm everything in this listing{job.payMin == null && job.payMax == null && job.payType !== "VOLUNTEER" ? ", such as the wage" : ""}.
                        Check the details against your real opening before approving.
                      </p>
                    )}
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                      <span>Found {ago(d.createdAt)}</span>
                      {link && <a href={link} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4 hover:text-foreground">View source listing</a>}
                    </div>
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
