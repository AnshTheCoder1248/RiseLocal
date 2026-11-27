import { Suspense } from "react";
import type { Metadata } from "next";
import { Skeleton } from "@/components/ui/skeleton";
import { PosterDashboard } from "./poster-dashboard";

export const metadata: Metadata = { title: "Dashboard — RiseLocal" };

export default function BusinessDashboardPage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-4 py-10 sm:px-6">
      <Suspense
        fallback={
          <>
            <Skeleton className="h-9 w-64" />
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
            <Skeleton className="h-64 w-full rounded-xl" />
          </>
        }
      >
        <PosterDashboard kind="business" />
      </Suspense>
    </main>
  );
}
