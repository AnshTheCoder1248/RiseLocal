import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import type { Metadata } from "next";
import { Pencil } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { db } from "@/lib/db";
import { formatPay, labelize } from "@/lib/jobs/format";
import type { AppStatus, JobStatus } from "@/generated/prisma/client";
import { requirePoster } from "@/app/business/business-user";
import { JobRowActions } from "@/app/business/job-row-actions";

export const metadata: Metadata = { title: "My jobs — RiseLocal" };

export default function MyJobsPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-semibold tracking-tight">My jobs</h1>
          <p className="text-muted-foreground">The gigs you’ve posted. Edit one to change it, or remove it when it’s filled or no longer needed.</p>
        </div>
        <Link href="/post" className={buttonVariants()}>Post a gig</Link>
      </header>
      <Suspense fallback={<div className="grid gap-3">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-32 w-full rounded-xl" />)}</div>}>
        <Gigs />
      </Suspense>
    </main>
  );
}

const STATUS: Partial<Record<JobStatus, { label: string; variant: "default" | "secondary" | "outline" }>> = {
  PUBLISHED: { label: "Live", variant: "default" },
  DRAFT: { label: "Draft", variant: "secondary" },
  PAUSED: { label: "Paused", variant: "outline" },
  FILLED: { label: "Filled", variant: "outline" },
  EXPIRED: { label: "Expired", variant: "outline" },
};

/** Applications still waiting — those applicants are told when a gig is filled or deleted. */
const OPEN: AppStatus[] = ["PENDING_GUARDIAN", "SENT", "VIEWED", "SHORTLISTED"];

const dateFmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

async function Gigs() {
  await connection();
  const { user } = await requirePoster("community", "/my-jobs");

  // Everything they've posted except deleted (archived) gigs.
  const gigs = await db.job.findMany({
    where: { postedById: user.id, status: { not: "ARCHIVED" } },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true, title: true, description: true, status: true, moderationHold: true, category: true, schedule: true,
      payType: true, payMin: true, payMax: true, areaLabel: true, remote: true, minAge: true, publishedAt: true, createdAt: true,
      _count: { select: { applications: { where: { status: { in: OPEN } } } } },
    },
  });

  if (gigs.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>You haven’t posted any gigs yet</CardTitle>
          <CardDescription>Need a hand with yard work, tutoring or errands? Post a gig and local teens can apply.</CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/post" className={buttonVariants()}>Post a gig</Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <ul className="grid gap-3">
      {gigs.map((g) => {
        const status = g.moderationHold ? { label: "In safety review", variant: "outline" as const } : (STATUS[g.status] ?? { label: labelize(g.status.toLowerCase()), variant: "outline" as const });
        const live = g.status === "PUBLISHED" && !g.moderationHold;
        return (
          <li key={g.id}>
            <Card>
              <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <CardTitle className="text-lg">
                    {live ? <Link href={`/jobs/${g.id}`} className="underline-offset-4 hover:underline">{g.title}</Link> : g.title}
                  </CardTitle>
                  <CardDescription>
                    {g.remote ? "Remote" : g.areaLabel} · {g.publishedAt ? `Posted ${dateFmt(g.publishedAt)}` : `Created ${dateFmt(g.createdAt)}`}
                  </CardDescription>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Link href={`/my-jobs/${g.id}/edit`} className={buttonVariants({ variant: "outline", size: "sm" })}>
                    <Pencil aria-hidden />
                    Edit
                  </Link>
                  {/* Live gigs can be marked filled or deleted; anything else can be deleted. */}
                  <JobRowActions id={g.id} title={g.title} published={g.status === "PUBLISHED"} openApplicants={g._count.applications} />
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={status.variant}>{status.label}</Badge>
                  <Badge variant="outline">{formatPay(g)}</Badge>
                  <Badge variant="outline">{labelize(g.category)}</Badge>
                  {g.schedule && <Badge variant="outline">{labelize(g.schedule)}</Badge>}
                  <Badge variant="outline">Ages {g.minAge}+</Badge>
                </div>
                <p className="line-clamp-2 leading-relaxed text-muted-foreground">{g.description}</p>
              </CardContent>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}
