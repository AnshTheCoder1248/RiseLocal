import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import type { Metadata } from "next";
import { Skeleton } from "@/components/ui/skeleton";
import { db } from "@/lib/db";
import { requirePoster } from "@/app/business/business-user";
import { PostGigForm } from "@/app/post/post-gig-form";

export const metadata: Metadata = { title: "Edit gig — RiseLocal" };

export default function EditGigPage({ params }: PageProps<"/my-jobs/[id]/edit">) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
      <Link href="/my-jobs" className="text-sm text-muted-foreground hover:text-foreground">← My jobs</Link>
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Edit gig</h1>
        <p className="text-muted-foreground">Changes to a live gig’s wording are checked again before students see them.</p>
      </header>
      <Suspense fallback={<Skeleton className="h-[600px] w-full rounded-xl" />}>
        <Editor params={params} />
      </Suspense>
    </main>
  );
}

async function Editor({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { user } = await requirePoster("community", "/my-jobs");
  const { id } = await params;

  // Only the community member who posted it can edit it; deleted gigs can't be edited.
  const job = await db.job.findFirst({
    where: { id, postedById: user.id, status: { not: "ARCHIVED" } },
    select: {
      id: true, status: true, title: true, description: true, category: true, tags: true, payType: true, payMin: true, payMax: true,
      minAge: true, schedule: true, remote: true, positions: true, startDate: true, areaLabel: true,
    },
  });
  if (!job) notFound();

  const { id: jobId, status, startDate, ...values } = job;
  return (
    <PostGigForm
      kind="gig"
      canPublish
      doneHref="/my-jobs"
      edit={{ id: jobId, status, values: { ...values, startDate: startDate?.toISOString() ?? null } }}
    />
  );
}
