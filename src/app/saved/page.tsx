import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { publicJobSelect } from "@/lib/jobs/search";
import { publicJobWhere } from "@/lib/safety/gate";
import { formatPay, labelize } from "@/lib/jobs/format";
import { SaveJobButton } from "@/app/jobs/[id]/save-button";

export const metadata: Metadata = { title: "Saved jobs — RiseLocal" };

export default function SavedJobsPage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-4 py-10 sm:px-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Saved jobs</h1>
        <p className="text-muted-foreground">Jobs you’re interested in, in one place.</p>
      </header>
      <Suspense fallback={<div className="grid gap-3">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-28 w-full rounded-xl" />)}</div>}>
        <SavedList />
      </Suspense>
    </main>
  );
}

async function SavedList() {
  await connection();
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/saved");
  if (user.role !== "STUDENT") redirect("/jobs");

  // Jobs that were filled, expired or pulled since saving drop out of the list.
  const saved = await db.savedJob.findMany({
    where: { userId: user.id, job: publicJobWhere() },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true, job: { select: publicJobSelect } },
  });

  if (saved.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No saved jobs yet</CardTitle>
          <CardDescription>Tap “Save” on any job to keep track of it here.</CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/jobs" className={buttonVariants()}>Browse jobs</Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <ul className="grid gap-3">
      {saved.map(({ job, createdAt }) => (
        <li key={job.id}>
          <Card>
            <CardHeader className="flex flex-row items-start gap-3">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <CardTitle className="text-lg">
                  <Link href={`/jobs/${job.id}`} className="hover:underline underline-offset-4">{job.title}</Link>
                </CardTitle>
                <CardDescription>
                  {job.org?.name ?? job.postedBy.displayName} · {job.remote ? "Remote" : job.areaLabel}
                </CardDescription>
              </div>
              <SaveJobButton jobId={job.id} initialSaved />
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-2 text-sm">
              <Badge>{formatPay(job)}</Badge>
              <Badge variant="secondary">{labelize(job.category)}</Badge>
              {job.schedule && <Badge variant="outline">{labelize(job.schedule)}</Badge>}
              <Badge variant="outline">Ages {job.minAge}+</Badge>
              <span className="ml-auto text-muted-foreground">
                Saved {createdAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              </span>
            </CardContent>
          </Card>
        </li>
      ))}
    </ul>
  );
}
