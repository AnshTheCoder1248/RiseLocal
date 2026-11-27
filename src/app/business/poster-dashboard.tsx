import Link from "next/link";
import { connection } from "next/server";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/db";
import { formatPay } from "@/lib/jobs/format";
import type { AppStatus } from "@/generated/prisma/client";
import { businessJobsWhere, POSTER, requirePoster } from "./business-user";
import { JobRowActions } from "./job-row-actions";

/** The business dashboard: stats and the published/draft job list. (Community members get a simpler list at /my-jobs.) */

/** Applications still in play — the people told when a job is filled or deleted. */
const OPEN: AppStatus[] = ["PENDING_GUARDIAN", "SENT", "VIEWED", "SHORTLISTED"];

const dateFmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export async function PosterDashboard({ kind }: { kind: "business" }) {
  await connection();
  const cfg = POSTER[kind];
  const noun: string = cfg.noun;
  const { user, org } = await requirePoster(kind, cfg.home);
  const mine = businessJobsWhere(user.id, org?.id);
  // Scout's pending suggestions live on their own tab, so they're left out of the job list.
  const listWhere = { AND: [mine, { status: { in: ["PUBLISHED" as const, "DRAFT" as const] } }, { NOT: { source: "AGENT" as const, status: "DRAFT" as const } }] };

  const [published, applicants, scoutDrafts, hired, jobs] = await Promise.all([
    db.job.count({ where: { AND: [mine, { status: "PUBLISHED" }] } }),
    // Held-for-guardian applications aren't visible to posters yet, so they don't count.
    db.application.count({ where: { job: mine, status: { not: "PENDING_GUARDIAN" } } }),
    kind === "business" && org ? db.agentDraft.count({ where: { orgId: org.id, reviewState: "pending" } }) : 0,
    db.application.count({ where: { job: mine, status: "HIRED" } }),
    db.job.findMany({
      where: listWhere,
      orderBy: [{ status: "desc" }, { updatedAt: "desc" }], // published (later in the enum) before drafts
      select: {
        id: true, title: true, status: true, source: true, payType: true, payMin: true, payMax: true, areaLabel: true, remote: true,
        minAge: true, moderationHold: true, publishedAt: true, createdAt: true, views: true,
        _count: { select: { applications: { where: { status: { not: "PENDING_GUARDIAN" } } } } },
        applications: { select: { status: true } },
      },
    }),
  ]);

  const stats = [
    { label: "Published", value: published },
    { label: "Applicants", value: applicants, href: cfg.applicants },
    { label: "Scout drafts", value: scoutDrafts, href: "/business/suggestions" },
    { label: "Hired", value: hired },
  ];

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-semibold tracking-tight">{kind === "business" ? (org?.name ?? "Your business") : "My jobs"}</h1>
          <p className="text-muted-foreground">
            {kind === "business" ? "Your job postings, applicants and Scout suggestions at a glance." : "The gigs you’ve posted, who applied and how they’re doing."}
          </p>
        </div>
        <Link href={cfg.post} className={buttonVariants()}>Post a {noun}</Link>
      </header>

      {org && !org.verified && (
        <p className="rounded-lg border border-amber-500/50 bg-amber-500/5 px-4 py-3 text-sm">
          <span className="font-medium">Your business isn’t verified yet.</span>{" "}
          <span className="text-muted-foreground">You can post jobs now. Publishing Scout suggestions unlocks once RiseLocal verifies your business.</span>
        </p>
      )}

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4" aria-label="Summary">
        {stats.map((s) => {
          const body = (
            <>
              <span className="text-3xl font-semibold tabular-nums">{s.value}</span>
              <span className="text-sm text-muted-foreground">{s.label}</span>
            </>
          );
          const cls = "flex flex-col gap-1 rounded-xl border bg-card px-4 py-4";
          return s.href ? (
            <Link key={s.label} href={s.href} className={`${cls} transition-colors hover:bg-muted/40`}>{body}</Link>
          ) : (
            <div key={s.label} className={cls}>{body}</div>
          );
        })}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Your {noun}s</h2>
        {jobs.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>No {noun}s yet</CardTitle>
              <CardDescription>Post your first {noun} and it’ll show up here with its applicants.</CardDescription>
            </CardHeader>
            <CardContent>
              <Link href={cfg.post} className={buttonVariants()}>Post a {noun}</Link>
            </CardContent>
          </Card>
        ) : (
          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full min-w-[700px] text-sm">
              <thead className="border-b bg-muted/40 text-left text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">{noun === "gig" ? "Gig" : "Job"}</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 text-right font-medium">Views</th>
                  <th className="px-4 py-2 text-right font-medium">Applicants</th>
                  <th className="px-4 py-2 text-right font-medium">Hired</th>
                  <th className="px-4 py-2 font-medium">Date</th>
                  <th className="px-4 py-2"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => {
                  const live = j.status === "PUBLISHED" && !j.moderationHold;
                  const hiredHere = j.applications.filter((a) => a.status === "HIRED").length;
                  const waiting = j.applications.filter((a) => OPEN.includes(a.status)).length;
                  return (
                    <tr key={j.id} className="border-b last:border-b-0">
                      <td className="px-4 py-3">
                        {live ? (
                          <Link href={`/jobs/${j.id}`} className="font-medium underline-offset-4 hover:underline">{j.title}</Link>
                        ) : (
                          <span className="font-medium">{j.title}</span>
                        )}
                        <div className="text-xs text-muted-foreground">
                          {formatPay(j)} · {j.remote ? "Remote" : j.areaLabel} · Ages {j.minAge}+{j.source === "AGENT" ? " · from Scout" : ""}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {j.moderationHold ? (
                          <Badge variant="outline">In safety review</Badge>
                        ) : (
                          <Badge variant={j.status === "PUBLISHED" ? "default" : "secondary"}>{j.status === "PUBLISHED" ? "Published" : "Draft"}</Badge>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums" title={j.status === "PUBLISHED" ? undefined : "Views are counted once a job is published"}>
                        {j.status === "PUBLISHED" ? j.views.toLocaleString() : "—"}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {j._count.applications ? (
                          <Link href={`${cfg.applicants}?job=${j.id}`} className="underline underline-offset-4 hover:text-foreground">{j._count.applications}</Link>
                        ) : (
                          0
                        )}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{hiredHere}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {j.publishedAt ? `Published ${dateFmt(j.publishedAt)}` : `Created ${dateFmt(j.createdAt)}`}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <JobRowActions id={j.id} title={j.title} published={j.status === "PUBLISHED"} openApplicants={waiting} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Published and draft {noun}s are shown. Use Remove when a {noun} is filled or you no longer want it listed.
          {kind === "business" && " Scout’s pending suggestions are on the Scout suggestions tab."}
        </p>
      </section>
    </>
  );
}
