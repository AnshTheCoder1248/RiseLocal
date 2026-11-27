import { Suspense } from "react";
import type { Metadata } from "next";
import { Skeleton } from "@/components/ui/skeleton";
import { PosterApplicants } from "@/app/business/applicants/poster-applicants";

export const metadata: Metadata = { title: "Applicants — RiseLocal" };

export default function ApplicantsPage({ searchParams }: PageProps<"/my-jobs/applicants">) {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Applicants</h1>
        <p className="text-muted-foreground">
          Everyone who applied to your gigs. You see their first name, age group, area, availability and skills. Contact details stay private.
        </p>
      </header>
      <Suspense fallback={<div className="grid gap-3">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-40 w-full rounded-xl" />)}</div>}>
        <PosterApplicants kind="community" searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
