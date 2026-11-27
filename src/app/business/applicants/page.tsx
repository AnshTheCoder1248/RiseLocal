import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "cn";
import { db } from "@/lib/db";
import { ageBand, ageOn } from "@/lib/auth/age";
import { labelize } from "@/lib/jobs/format";
import type { AppStatus } from "@/generated/prisma/client";
import { businessJobsWhere, requireBusiness } from "../business-user";
import { ApplicantActions } from "./applicant-actions";
import { MarkViewed } from "./mark-viewed";

export const metadata: Metadata = { title: "Applicants — RiseLocal" };

export default function ApplicantsPage({ searchParams }: PageProps<"/business/applicants">) {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Applicants</h1>
        <p className="text-muted-foreground">
          Everyone who applied to your jobs. You see their first name, age group, area, availability and skills. Contact details stay private.
        </p>
      </header>
      <Suspense fallback={<div className="grid gap-3">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-40 w-full rounded-xl" />)}</div>}>
        <Applicants searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

const FILTERS = [
  { value: "all", label: "All" },
  { value: "new", label: "New", statuses: ["SENT", "VIEWED"] as AppStatus[] },
  { value: "shortlisted", label: "Shortlisted", statuses: ["SHORTLISTED"] as AppStatus[] },
  { value: "hired", label: "Hired", statuses: ["HIRED"] as AppStatus[] },
  { value: "declined", label: "Not selected", statuses: ["DECLINED", "WITHDRAWN"] as AppStatus[] },
] as const;

const STATUS: Record<AppStatus, { label: string; variant: "default" | "secondary" | "outline" }> = {
  PENDING_GUARDIAN: { label: "Waiting for guardian", variant: "outline" },
  SENT: { label: "New", variant: "default" },
  VIEWED: { label: "Viewed", variant: "secondary" },
  SHORTLISTED: { label: "Shortlisted", variant: "default" },
  HIRED: { label: "Hired", variant: "default" },
  DECLINED: { label: "Not selected", variant: "outline" },
  WITHDRAWN: { label: "Withdrawn", variant: "outline" },
};

const dateFmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

async function Applicants({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await connection();
  const { user, org } = await requireBusiness("/business/applicants");
  const sp = await searchParams;
  const jobId = first(sp.job);
  const filter = FILTERS.find((f) => f.value === first(sp.status)) ?? FILTERS[0];
  const mine = businessJobsWhere(user.id, org?.id);

  // Guardian-held applications (ages 13–15) stay hidden from posters until a guardian approves.
  const visible = { job: mine, status: { not: "PENDING_GUARDIAN" as const } };
  const [jobs, apps, counts] = await Promise.all([
    db.job.findMany({
      where: { AND: [mine, { applications: { some: { status: { not: "PENDING_GUARDIAN" } } } }] },
      select: { id: true, title: true },
      orderBy: { createdAt: "desc" },
    }),
    db.application.findMany({
      where: { ...visible, ...(jobId && { jobId }), ...("statuses" in filter && { status: { in: filter.statuses } }) },
      orderBy: { createdAt: "desc" },
      include: {
        job: { select: { id: true, title: true, status: true } },
        student: { select: { id: true, dateOfBirth: true, isMinor: true, displayName: true, studentProfile: { select: { firstName: true, areaLabel: true, availability: true, skills: true } } } },
      },
    }),
    db.application.groupBy({ by: ["status"], where: { ...visible, ...(jobId && { jobId }) }, _count: true }),
  ]);

  // Safety log (SAFE-7): record who looked at a minor's application.
  const minorApps = apps.filter((a) => a.student.isMinor);
  if (minorApps.length) {
    await db.auditLog.createMany({ data: minorApps.map((a) => ({ actorId: user.id, action: "application.view", targetType: "application", targetId: a.id })) });
  }

  const countFor = (f: (typeof FILTERS)[number]) =>
    counts.filter((c) => !("statuses" in f) || f.statuses.includes(c.status)).reduce((n, c) => n + c._count, 0);
  const href = (params: { job?: string; status?: string }) => {
    const p = new URLSearchParams();
    const j = "job" in params ? params.job : jobId;
    const s = "status" in params ? params.status : filter.value;
    if (j) p.set("job", j);
    if (s && s !== "all") p.set("status", s);
    const q = p.toString();
    return q ? `/business/applicants?${q}` : "/business/applicants";
  };

  if (jobs.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No applicants yet</CardTitle>
          <CardDescription>When students apply to your jobs, they’ll show up here.</CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/business/post" className={buttonVariants()}>Post a job</Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <MarkViewed ids={apps.filter((a) => a.status === "SENT").map((a) => a.id)} />

      <div className="flex flex-col gap-3">
        <nav aria-label="Filter by job" className="flex flex-wrap gap-2">
          {[{ id: undefined, title: "All jobs" }, ...jobs].map((j) => {
            const active = (j.id ?? null) === (jobId ?? null);
            return (
              <Link
                key={j.id ?? "all"}
                href={href({ job: j.id })}
                aria-current={active ? "page" : undefined}
                className={cn("rounded-full border px-3 py-1 text-sm transition-colors hover:bg-muted", active && "border-primary bg-primary text-primary-foreground hover:bg-primary/90")}
              >
                {j.title}
              </Link>
            );
          })}
        </nav>
        <nav aria-label="Filter by status" className="flex flex-wrap gap-1 border-b">
          {FILTERS.map((f) => {
            const active = f.value === filter.value;
            return (
              <Link
                key={f.value}
                href={href({ status: f.value })}
                aria-current={active ? "page" : undefined}
                className={cn("-mb-px border-b-2 px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground", active ? "border-primary font-medium text-foreground" : "border-transparent")}
              >
                {f.label} <span className="tabular-nums text-muted-foreground">({countFor(f)})</span>
              </Link>
            );
          })}
        </nav>
      </div>

      {apps.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">No applicants match this filter.</p>
      ) : (
        <ul className="grid gap-3">
          {apps.map((a) => {
            const p = a.student.studentProfile;
            const name = p?.firstName ?? a.student.displayName.split(/\s+/)[0] ?? "Student";
            const band = a.student.dateOfBirth ? ageBand(ageOn(a.student.dateOfBirth)) : null;
            const status = STATUS[a.status];
            const closed = a.job.status !== "PUBLISHED";
            return (
              <li key={a.id}>
                <Card>
                  <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start">
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <CardTitle className="flex flex-wrap items-center gap-2 text-lg">
                        {name}
                        <Badge variant={status.variant}>{status.label}</Badge>
                      </CardTitle>
                      <CardDescription>
                        Applied to <span className="font-medium text-foreground">{a.job.title}</span> on {dateFmt(a.createdAt)}
                        {closed && ` · job ${labelize(a.job.status.toLowerCase())}`}
                      </CardDescription>
                    </div>
                    <ApplicantActions id={a.id} name={name} status={a.status} />
                  </CardHeader>
                  <CardContent className="flex flex-col gap-3 text-sm">
                    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
                      <div>
                        <dt className="text-muted-foreground">Age group</dt>
                        <dd className="font-medium">{band ?? "—"}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Area</dt>
                        <dd className="font-medium">{p?.areaLabel ?? "Not shared"}</dd>
                      </div>
                      <div className="col-span-2">
                        <dt className="text-muted-foreground">Availability</dt>
                        <dd className="flex flex-wrap gap-1 pt-0.5">
                          {p?.availability.length ? p.availability.map((x) => <Badge key={x} variant="outline">{labelize(x)}</Badge>) : <span className="text-muted-foreground">Not shared</span>}
                        </dd>
                      </div>
                      <div className="col-span-2 sm:col-span-4">
                        <dt className="text-muted-foreground">Skills</dt>
                        <dd className="flex flex-wrap gap-1 pt-0.5">
                          {p?.skills.length ? p.skills.map((x) => <Badge key={x} variant="secondary">{labelize(x)}</Badge>) : <span className="text-muted-foreground">Not shared</span>}
                        </dd>
                      </div>
                    </dl>
                    {a.note && (
                      <p className="rounded-lg bg-muted/50 px-3 py-2">
                        <span className="font-medium">Their note: </span>
                        <span className="text-muted-foreground">{a.note}</span>
                      </p>
                    )}
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
