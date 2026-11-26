import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { formatPay, labelize, postedAgo } from "@/lib/jobs/format";
import { ReviewActions } from "./review-actions";

export const metadata: Metadata = { title: "Review jobs — RiseLocal" };

export default function ReviewPage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-4 py-10 sm:px-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Review jobs</h1>
        <p className="text-muted-foreground">
          Every job Scout has found that’s waiting for review. Approving runs the safety check and publishes the job to the board.
        </p>
      </header>
      <Suspense fallback={<div className="grid gap-3">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-44 w-full rounded-xl" />)}</div>}>
        <Queues />
      </Suspense>
    </main>
  );
}

type Payload = { employer?: string; applyUrl?: string };

/** "today", "yesterday", "3 days ago"… — postedAgo without its "Posted" prefix. */
const ago = (d: Date) => postedAgo(d)!.replace(/^Posted /, "");

async function Queues() {
  await connection();
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/review");
  if (user.role !== "ADMIN") redirect("/jobs");

  const [drafts, holds] = await Promise.all([
    // Every pending Scout draft — including ones matched to a business — so nothing the crawl
    // finds is invisible to admins (a matched business may have no members to review it).
    db.agentDraft.findMany({
      where: { reviewState: "pending", job: { isNot: null } },
      orderBy: [{ createdAt: "desc" }, { confidence: { sort: "desc", nulls: "last" } }],
      include: { job: { include: { org: { select: { name: true } } } } },
    }),
    db.job.findMany({
      where: { moderationHold: true, archivedAt: null },
      orderBy: { updatedAt: "asc" },
      include: { agentDraft: { select: { rawPayload: true, sourceUrl: true } } },
    }),
  ]);

  return (
    <>
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">
          Found by Scout <span className="font-normal text-muted-foreground">({drafts.length})</span>
        </h2>
        {drafts.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>Nothing to review</CardTitle>
              <CardDescription>New jobs appear here after each Scout crawl.</CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <ul className="grid gap-3">
            {drafts.map((d) => {
              const p = (d.rawPayload ?? {}) as Payload;
              return (
                <li key={d.id}>
                  <JobCard
                    job={d.job!}
                    employer={p.employer}
                    link={p.applyUrl ?? d.sourceUrl}
                    meta={[
                      `Found ${ago(d.createdAt)}`,
                      d.job!.org && `Matched to ${d.job!.org.name}`,
                      d.confidence != null && `${Math.round(d.confidence * 100)}% extraction confidence`,
                    ].filter(Boolean).join(" · ")}
                    actions={<ReviewActions kind="draft" id={d.id} title={d.job!.title} />}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {holds.length > 0 && (
        <section className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="text-lg font-semibold">
              On safety hold <span className="font-normal text-muted-foreground">({holds.length})</span>
            </h2>
            <p className="text-sm text-muted-foreground">The safety check flagged these. Approving publishes them anyway, so read the flags first.</p>
          </div>
          <ul className="grid gap-3">
            {holds.map((job) => {
              const p = (job.agentDraft?.rawPayload ?? {}) as Payload;
              return (
                <li key={job.id}>
                  <JobCard
                    job={job}
                    employer={p.employer}
                    link={p.applyUrl ?? job.agentDraft?.sourceUrl}
                    meta={`${labelize(job.source.toLowerCase())} post · held ${ago(job.updatedAt)}`}
                    actions={<ReviewActions kind="hold" id={job.id} title={job.title} />}
                  />
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </>
  );
}

type JobLike = {
  title: string; description: string; category: string; schedule: string | null; minAge: number; areaLabel: string; remote: boolean;
  payType: "HOURLY" | "FIXED" | "VOLUNTEER"; payMin: number | null; payMax: number | null; safetyFlags: string[]; suitability: number | null;
};

function JobCard({ job, employer, link, meta, actions }: { job: JobLike; employer?: string; link?: string | null; meta: string; actions: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <CardTitle className="text-lg">{job.title}</CardTitle>
          <CardDescription>
            {employer ?? "Unknown employer"} · {job.remote ? "Remote" : job.areaLabel}
          </CardDescription>
        </div>
        {actions}
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <Badge>{formatPay(job)}</Badge>
          <Badge variant="secondary">{labelize(job.category)}</Badge>
          {job.schedule && <Badge variant="outline">{labelize(job.schedule)}</Badge>}
          <Badge variant="outline">Ages {job.minAge}+</Badge>
          {job.suitability != null && <Badge variant="outline">Suitability {Math.round(job.suitability * 100)}%</Badge>}
          {job.safetyFlags.map((f) => <Badge key={f} variant="destructive">{labelize(f)}</Badge>)}
        </div>
        <p className="line-clamp-3 leading-relaxed text-muted-foreground">{job.description}</p>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>{meta}</span>
          {link && (
            <a href={link} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4 hover:text-foreground">
              View source
            </a>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
