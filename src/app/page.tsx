import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getCurrentUser } from "@/lib/auth/session";

const pillars = [
  { title: "Find work nearby", body: "Part-time jobs and neighborhood gigs in one board, filtered by pay, distance, schedule and age." },
  { title: "Never miss a match", body: "Save a search as a watch and get notified within minutes when a matching job goes live." },
  { title: "Safe by design", body: "Guardian sign-off for ages 13–15, no public contact info, and every post screened before it’s shown." },
];

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-12 px-4 py-16 sm:px-6 sm:py-24">
      <section className="flex flex-col items-start gap-6">
        <Badge variant="secondary">For teens 13–18</Badge>
        <h1 className="max-w-2xl text-4xl font-semibold tracking-tight sm:text-5xl">
          Your first job, close to home.
        </h1>
        <p className="max-w-xl text-lg text-muted-foreground">
          RiseLocal brings together real openings found by our Scout agent, listings from local businesses, and gigs
          from neighbors — tutoring, lawn mowing, snow removal and more.
        </p>
        {/* Depends on who's signed in, so it streams in; the rest of the page is static. */}
        <Suspense fallback={<Skeleton className="h-9 w-64" />}>
          <Actions />
        </Suspense>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        {pillars.map((p) => (
          <Card key={p.title}>
            <CardHeader>
              <CardTitle>{p.title}</CardTitle>
              <CardDescription>{p.body}</CardDescription>
            </CardHeader>
            <CardContent />
          </Card>
        ))}
      </section>
    </main>
  );
}

/** Visitors only: signed-in users are sent to the job board (see src/proxy.ts; this is the fallback). */
async function Actions() {
  await connection();
  if (await getCurrentUser()) redirect("/jobs");
  return (
    <div className="flex flex-wrap gap-3">
      <Link href="/signup" className={buttonVariants({ size: "lg" })}>Create an account</Link>
    </div>
  );
}
