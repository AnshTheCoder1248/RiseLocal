import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import type { Metadata } from "next";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { MAX_OPEN_GIGS_NEW_POSTER } from "@/lib/safety/gate";
import { PostGigForm } from "./post-gig-form";

export const metadata: Metadata = { title: "Post a gig — RiseLocal" };

export default function PostGigPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Post a gig</h1>
        <p className="text-muted-foreground">
          Need a hand with yard work, tutoring, pet sitting or errands? Local teens can apply right here on RiseLocal.
        </p>
      </header>
      <Suspense fallback={<Skeleton className="h-[600px] w-full rounded-xl" />}>
        <Gate />
      </Suspense>
    </main>
  );
}

function Notice({ title, body, children }: { title: string; body: string; children?: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{body}</CardDescription>
      </CardHeader>
      {children && <CardContent className="flex flex-wrap gap-2">{children}</CardContent>}
    </Card>
  );
}

async function Gate() {
  await connection();
  const user = await getCurrentUser();

  if (!user) {
    return (
      <Notice title="Sign in to post a gig" body="Gigs are posted by neighbors with a RiseLocal community account (adults 18+).">
        <Link href="/login?next=/post" className={buttonVariants()}>Sign in</Link>
        <Link href="/signup" className={buttonVariants({ variant: "outline" })}>Create a community account</Link>
      </Notice>
    );
  }
  // Posting is for adults only (18+); students and any minor go back to the board.
  if (user.role === "STUDENT" || user.isMinor) redirect("/jobs");
  // Businesses post jobs from their own portal.
  if (user.role === "EMPLOYER") redirect("/business/post");
  if (user.status !== "ACTIVE") {
    return <Notice title="Your account isn’t active yet" body="Finish activating your account before posting a gig." />;
  }

  // Mirrors the publish gate (GIG-6): new posters are capped until a gig is completed.
  const [open, completed] = await Promise.all([
    db.job.count({ where: { postedById: user.id, status: "PUBLISHED" } }),
    db.application.count({ where: { job: { postedById: user.id }, posterConfirmedAt: { not: null }, studentConfirmedAt: { not: null } } }),
  ]);
  const limited = completed === 0;
  const atLimit = limited && open >= MAX_OPEN_GIGS_NEW_POSTER;

  return (
    <>
      {limited && (
        <p className="rounded-lg border px-3 py-2 text-sm text-muted-foreground">
          {atLimit
            ? `You have ${open} open gigs, the most a new poster can have at once. You can still save this one as a draft. Once a gig is completed, the limit is lifted.`
            : `New posters can have up to ${MAX_OPEN_GIGS_NEW_POSTER} open gigs at once. You have ${open} open.`}
        </p>
      )}
      <PostGigForm canPublish={!atLimit} doneHref="/my-jobs" />
    </>
  );
}
