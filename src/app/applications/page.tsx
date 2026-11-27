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
import { formatPay } from "@/lib/jobs/format";
import { publicJobWhere } from "@/lib/safety/gate";
import type { AppStatus } from "@/generated/prisma/client";
import { WithdrawButton } from "./withdraw-button";

export const metadata: Metadata = { title: "My applications — RiseLocal" };

export default function ApplicationsPage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-4 py-10 sm:px-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">My applications</h1>
        <p className="text-muted-foreground">Every job you’ve applied to, and where each application stands.</p>
      </header>
      <Suspense fallback={<div className="grid gap-3">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-32 w-full rounded-xl" />)}</div>}>
        <ApplicationList />
      </Suspense>
    </main>
  );
}

const STATUS: Record<AppStatus, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  PENDING_GUARDIAN: { label: "Waiting for guardian approval", variant: "outline" },
  SENT: { label: "Sent", variant: "secondary" },
  VIEWED: { label: "Viewed by poster", variant: "secondary" },
  SHORTLISTED: { label: "Shortlisted", variant: "default" },
  HIRED: { label: "Hired", variant: "default" },
  DECLINED: { label: "Not selected", variant: "outline" },
  WITHDRAWN: { label: "Withdrawn", variant: "outline" },
};

const CAN_WITHDRAW: AppStatus[] = ["PENDING_GUARDIAN", "SENT", "VIEWED", "SHORTLISTED"];

const dateFmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

async function ApplicationList() {
  await connection();
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/applications");
  if (user.role !== "STUDENT") redirect("/jobs");

  const [apps, visible] = await Promise.all([
    db.application.findMany({
      where: { studentId: user.id },
      orderBy: { createdAt: "desc" },
      include: {
        job: {
          select: {
            id: true, title: true, areaLabel: true, remote: true, payType: true, payMin: true, payMax: true,
            org: { select: { name: true } },
            postedBy: { select: { displayName: true } },
            agentDraft: { select: { rawPayload: true } },
          },
        },
      },
    }),
    // Which of those jobs are still on the board, so we only link to pages that exist.
    db.job.findMany({ where: { ...publicJobWhere(), applications: { some: { studentId: user.id } } }, select: { id: true } }),
  ]);
  const listed = new Set(visible.map((j) => j.id));

  if (apps.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No applications yet</CardTitle>
          <CardDescription>When you apply to a job, it shows up here so you can follow its status.</CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/jobs" className={buttonVariants()}>Browse jobs</Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <ul className="grid gap-3">
      {apps.map((app) => {
        const { job } = app;
        // Scout jobs are owned by an admin account; show the employer the crawl found instead.
        const scoutEmployer = (job.agentDraft?.rawPayload as { employer?: string } | null)?.employer;
        const employer = job.org?.name ?? scoutEmployer ?? job.postedBy.displayName;
        const status = STATUS[app.status];
        return (
          <li key={app.id}>
            <Card>
              <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <CardTitle className="text-lg">
                    {listed.has(job.id) ? (
                      <Link href={`/jobs/${job.id}`} className="underline-offset-4 hover:underline">{job.title}</Link>
                    ) : (
                      job.title
                    )}
                  </CardTitle>
                  <CardDescription>
                    {employer} · {job.remote ? "Remote" : job.areaLabel}
                  </CardDescription>
                </div>
                {CAN_WITHDRAW.includes(app.status) && <WithdrawButton applicationId={app.id} title={job.title} />}
              </CardHeader>
              <CardContent className="flex flex-col gap-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={status.variant}>{status.label}</Badge>
                  <Badge variant="outline">{formatPay(job)}</Badge>
                  {!listed.has(job.id) && <Badge variant="outline">No longer listed</Badge>}
                  <span className="ml-auto text-muted-foreground">Applied {dateFmt(app.createdAt)}</span>
                </div>
                {app.note && (
                  <p className="rounded-lg bg-muted/50 px-3 py-2 text-muted-foreground">
                    <span className="font-medium text-foreground">Your note: </span>
                    {app.note}
                  </p>
                )}
              </CardContent>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}
