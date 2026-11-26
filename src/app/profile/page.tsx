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
import { getCurrentUser, type CurrentUser } from "@/lib/auth/session";
import { ageBand, ageOn } from "@/lib/auth/age";
import { labelize } from "@/lib/jobs/format";
import { formatBytes } from "@/lib/resume";
import { ROLE_LABEL } from "@/lib/user-display";
import { AvatarPicker } from "./avatar-picker";

export const metadata: Metadata = { title: "Profile — RiseLocal" };

export default function ProfilePage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-semibold tracking-tight">Profile</h1>
      <Suspense fallback={<div className="flex flex-col gap-4"><Skeleton className="h-32 w-full rounded-xl" /><Skeleton className="h-48 w-full rounded-xl" /></div>}>
        <Profile />
      </Suspense>
    </main>
  );
}

const dateFmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

const STATUS: Record<string, { label: string; variant: "secondary" | "outline" | "destructive" }> = {
  ACTIVE: { label: "Active", variant: "secondary" },
  PENDING: { label: "Pending", variant: "outline" },
  SUSPENDED: { label: "Suspended", variant: "destructive" },
  BANNED: { label: "Banned", variant: "destructive" },
};

async function Profile() {
  await connection();
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/profile");
  const { createdAt } = await db.user.findUniqueOrThrow({ where: { id: user.id }, select: { createdAt: true } });
  const status = STATUS[user.status] ?? { label: user.status, variant: "outline" as const };

  return (
    <>
      <Card>
        <CardContent className="flex flex-wrap items-center gap-5">
          <AvatarPicker name={user.displayName} image={user.image} hasCustom={user.image?.startsWith("/api/avatar") ?? false} />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="truncate text-xl font-semibold">{user.displayName}</span>
            <span className="truncate text-sm text-muted-foreground">{user.email}</span>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Badge>{ROLE_LABEL[user.role] ?? user.role}</Badge>
              <Badge variant={status.variant}>{status.label}</Badge>
              <span className="text-xs text-muted-foreground">Member since {dateFmt(createdAt)}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {user.role === "STUDENT" && <StudentSections user={user} />}
      {user.role === "EMPLOYER" && <EmployerSections user={user} />}
      {user.role === "COMMUNITY" && <CommunitySections user={user} />}
      {user.role === "ADMIN" && (
        <Section title="Admin account" description="You can moderate reports and manage Scout sources.">
          <p className="text-sm text-muted-foreground">Admin tools don’t have pages yet.</p>
        </Section>
      )}
    </>
  );
}

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function Details({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="font-medium">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

const Tags = ({ items, empty }: { items: string[]; empty: string }) =>
  items.length ? (
    <span className="flex flex-wrap gap-1 pt-0.5">{items.map((s) => <Badge key={s} variant="outline">{labelize(s)}</Badge>)}</span>
  ) : (
    <span className="font-normal text-muted-foreground">{empty}</span>
  );

async function StudentSections({ user }: { user: CurrentUser }) {
  const [profile, guardian, resume, applications, saved, certificates] = await Promise.all([
    db.studentProfile.findUnique({ where: { userId: user.id } }),
    db.guardian.findUnique({ where: { studentId: user.id }, select: { email: true, consentAt: true, requireApproval: true } }),
    db.resume.findUnique({ where: { userId: user.id }, select: { fileName: true, size: true } }),
    db.application.count({ where: { studentId: user.id } }),
    db.savedJob.count({ where: { userId: user.id } }),
    db.certificate.count({ where: { studentId: user.id, status: "active" } }),
  ]);

  return (
    <>
      <Section title="About you" description="What posters see when you apply. Your contact details stay private.">
        <Details
          rows={[
            ["First name", profile?.firstName ?? user.displayName.split(/\s+/)[0]],
            ["Age group", user.dateOfBirth ? ageBand(ageOn(user.dateOfBirth)) : "—"],
            ["Area", profile?.areaLabel ?? <span className="font-normal text-muted-foreground">Not set</span>],
            ["Availability", <Tags key="a" items={profile?.availability ?? []} empty="Not set" />],
            ["Skills", <Tags key="s" items={profile?.skills ?? []} empty="Not set" />],
            ...(profile?.bio ? [["Bio", <span key="b" className="font-normal whitespace-pre-line">{profile.bio}</span>] as [string, React.ReactNode]] : []),
          ]}
        />
      </Section>

      <Section title="Your activity">
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label="Applications" value={applications} />
          <Stat label="Saved jobs" value={saved} href="/saved" />
          <Stat label="Certificates" value={certificates} />
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm">
          <span>
            <span className="text-muted-foreground">Resume: </span>
            {resume ? <span className="font-medium">{resume.fileName} ({formatBytes(resume.size)})</span> : <span className="text-muted-foreground">Not uploaded</span>}
          </span>
          <Link href="/resume" className={buttonVariants({ variant: "outline", size: "sm" })}>{resume ? "Manage" : "Upload"}</Link>
        </div>
      </Section>

      {guardian && (
        <Section title="Parent or guardian" description="Required for ages 13–15.">
          <Details
            rows={[
              ["Email", guardian.email],
              ["Consent", guardian.consentAt ? `Given ${dateFmt(guardian.consentAt)}` : <span className="text-muted-foreground">Waiting for approval</span>],
              ["Applications", guardian.requireApproval ? "Need guardian approval before sending" : "Sent directly"],
            ]}
          />
        </Section>
      )}
    </>
  );
}

async function EmployerSections({ user }: { user: CurrentUser }) {
  const [org, jobs] = await Promise.all([
    user.orgId
      ? db.employerOrg.findUnique({ where: { id: user.orgId }, select: { name: true, website: true, verificationStatus: true, _count: { select: { locations: true } } } })
      : null,
    db.job.groupBy({ by: ["status"], where: { postedById: user.id }, _count: true }),
  ]);
  const count = (s: string) => jobs.find((j) => j.status === s)?._count ?? 0;

  return (
    <>
      <Section title="Business">
        {org ? (
          <Details
            rows={[
              ["Name", org.name],
              ["Website", org.website ?? <span className="font-normal text-muted-foreground">Not set</span>],
              ["Verification", labelize(org.verificationStatus.toLowerCase())],
              ["Locations", String(org._count.locations)],
            ]}
          />
        ) : (
          <p className="text-sm text-muted-foreground">Your account isn’t linked to a business yet.</p>
        )}
      </Section>
      <Section title="Your listings">
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label="Published" value={count("PUBLISHED")} />
          <Stat label="Drafts" value={count("DRAFT")} />
          <Stat label="Filled" value={count("FILLED")} />
        </div>
      </Section>
    </>
  );
}

async function CommunitySections({ user }: { user: CurrentUser }) {
  const [jobs, completed] = await Promise.all([
    db.job.groupBy({ by: ["status"], where: { postedById: user.id }, _count: true }),
    db.application.count({ where: { job: { postedById: user.id }, posterConfirmedAt: { not: null }, studentConfirmedAt: { not: null } } }),
  ]);
  const count = (s: string) => jobs.find((j) => j.status === s)?._count ?? 0;

  return (
    <Section title="Your gigs" description="Neighborhood gigs you’ve posted for local teens.">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Open" value={count("PUBLISHED")} />
        <Stat label="Drafts" value={count("DRAFT")} />
        <Stat label="Completed" value={completed} />
      </div>
      <Link href="/post" className={`${buttonVariants({ variant: "outline", size: "sm" })} mt-4`}>Post a gig</Link>
    </Section>
  );
}

function Stat({ label, value, href }: { label: string; value: number; href?: string }) {
  const body = (
    <>
      <span className="text-2xl font-semibold tabular-nums">{value}</span>
      <span className="text-sm text-muted-foreground">{label}</span>
    </>
  );
  const cls = "flex flex-col rounded-lg border px-3 py-2";
  return href ? <Link href={href} className={`${cls} transition-colors hover:bg-muted/40`}>{body}</Link> : <div className={cls}>{body}</div>;
}
