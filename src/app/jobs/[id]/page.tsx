import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { ageOn } from "@/lib/auth/age";
import { publicJobSelect } from "@/lib/jobs/search";
import { publicJobWhere } from "@/lib/safety/gate";
import { formatPay, labelize, postedAgo } from "@/lib/jobs/format";
import { ApplyForm } from "./apply-form";
import { SaveJobButton } from "./save-button";
import { WatchJobButton } from "./watch-button";
import { RecordView } from "./record-view";
import type { BoardFilters } from "@/lib/validation/jobs";

export default function JobPage({ params }: PageProps<"/jobs/[id]">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
      <Link href="/jobs" className="text-sm text-muted-foreground hover:text-foreground">← All jobs</Link>
      <Suspense fallback={<DetailSkeleton />}>
        <JobDetail params={params} />
      </Suspense>
    </main>
  );
}

async function JobDetail({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const job = await db.job.findFirst({ where: { id, ...publicJobWhere() }, select: publicJobSelect });
  if (!job) notFound();

  const viewer = await getCurrentUser();
  const age = viewer?.role === "STUDENT" && viewer.dateOfBirth ? ageOn(viewer.dateOfBirth) : undefined;
  // "Watch" saves an alert for jobs like this one: same type, nearby (or remote), and old enough for.
  const watchName = `Jobs like ${job.title}`.slice(0, 80);
  const watchFilters: BoardFilters = {
    category: [job.category] as NonNullable<BoardFilters["category"]>,
    eligibleOnly: true,
    ...(job.remote ? { remote: true } : job.lat != null && job.lng != null ? { lat: job.lat, lng: job.lng, radiusMi: 10 } : {}),
  };
  const [existing, saved, watch] = viewer?.role === "STUDENT"
    ? await Promise.all([
        db.application.findFirst({ where: { jobId: id, studentId: viewer.id }, select: { status: true } }),
        db.savedJob.count({ where: { jobId: id, userId: viewer.id } }),
        db.watch.findFirst({ where: { studentId: viewer.id, name: watchName }, select: { frequency: true } }),
      ])
    : [null, 0, null];

  const details = [
    ["Pay", formatPay(job)],
    ["Category", labelize(job.category)],
    ["Schedule", job.schedule ? labelize(job.schedule) : "Flexible"],
    ["Location", job.remote ? "Remote" : job.areaLabel],
    ["Minimum age", `${job.minAge}+`],
    ["Openings", String(job.positions)],
    ...(job.startDate ? [["Starts", job.startDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })]] : []),
  ];

  return (
    <>
      <RecordView jobId={job.id} />
      <header className="flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <h1 className="flex-1 text-3xl font-semibold tracking-tight">{job.title}</h1>
          {viewer?.role === "STUDENT" && (
            <div className="flex shrink-0 items-start gap-2">
              <WatchJobButton name={watchName} filters={watchFilters} watching={watch ? (watch.frequency === "daily" ? "daily" : "instant") : null} />
              <SaveJobButton jobId={job.id} initialSaved={saved > 0} />
            </div>
          )}
        </div>
        <p className="text-muted-foreground">
          {job.org?.name ?? job.postedBy.displayName}
          {job.org?.verified && " · Verified business"}
          {job.publishedAt && ` · ${postedAgo(job.publishedAt)}`}
        </p>
        <div className="flex flex-wrap gap-2">
          <Badge>{formatPay(job)}</Badge>
          {job.tags.map((t) => <Badge key={t} variant="outline">{t}</Badge>)}
        </div>
      </header>

      <Card>
        <CardContent>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
            {details.map(([k, v]) => (
              <div key={k}>
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="font-medium">{v}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">About this job</h2>
        <p className="whitespace-pre-line leading-relaxed">{job.description}</p>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Apply</CardTitle>
          <CardDescription>Your RiseLocal profile is shared with the poster. Contact details stay private.</CardDescription>
        </CardHeader>
        <CardContent>
          {!viewer ? (
            <div className="flex flex-wrap gap-2">
              <Link href={`/login?next=/jobs/${job.id}`} className={buttonVariants()}>Sign in to apply</Link>
              <Link href="/signup" className={buttonVariants({ variant: "outline" })}>Create an account</Link>
            </div>
          ) : viewer.role !== "STUDENT" ? (
            <p className="text-sm text-muted-foreground">Only student accounts can apply to jobs.</p>
          ) : existing ? (
            <p className="text-sm">You’ve already applied. Status: <strong>{labelize(existing.status.toLowerCase().replace(/_/g, " "))}</strong></p>
          ) : viewer.status === "PENDING" ? (
            <p className="text-sm text-muted-foreground">Your account is waiting for guardian approval. You can apply once it’s approved.</p>
          ) : age != null && age < job.minAge ? (
            <p className="text-sm text-muted-foreground">This job is for ages {job.minAge}+.</p>
          ) : (
            <ApplyForm jobId={job.id} />
          )}
        </CardContent>
      </Card>
    </>
  );
}

function DetailSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-9 w-2/3" />
      <Skeleton className="h-5 w-1/3" />
      <Skeleton className="h-32 w-full rounded-xl" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}
