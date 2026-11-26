import Link from "next/link";
import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { getCurrentUser } from "@/lib/auth/session";
import { ageOn } from "@/lib/auth/age";
import { searchBoard, withEligibility } from "@/lib/jobs/search";
import { formatPay, labelize, postedAgo } from "@/lib/jobs/format";
import { boardQuerySchema, CATEGORIES } from "@/lib/validation/jobs";

export const metadata: Metadata = { title: "Browse jobs — RiseLocal" };

type SearchParams = Record<string, string | string[] | undefined>;

const SORTS = [
  { value: "best", label: "Best match" },
  { value: "newest", label: "Newest" },
  { value: "pay", label: "Highest pay" },
] as const;

const selectClass =
  "h-8 rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

export default function JobsPage({ searchParams }: PageProps<"/jobs">) {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-4 py-10 sm:px-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Browse jobs</h1>
        <p className="text-muted-foreground">Part-time jobs and neighborhood gigs, screened before they’re shown.</p>
      </header>

      <Suspense fallback={<ResultsSkeleton />}>
        <Board searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

async function Board({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await connection();
  const sp = await searchParams;
  const raw = { q: first(sp.q), category: first(sp.category), sort: first(sp.sort), page: first(sp.page) };
  const parsed = boardQuerySchema.safeParse(raw);
  const query = parsed.success ? parsed.data : boardQuerySchema.parse({});

  const viewer = await getCurrentUser();
  const age = viewer?.role === "STUDENT" && viewer.dateOfBirth ? ageOn(viewer.dateOfBirth) : undefined;
  const result = await searchBoard(query, { age });
  const items = withEligibility(result.items, age);
  const pages = Math.max(1, Math.ceil(result.total / result.pageSize));

  const pageHref = (page: number) => {
    const p = new URLSearchParams();
    if (raw.q) p.set("q", raw.q);
    if (raw.category) p.set("category", raw.category);
    if (raw.sort) p.set("sort", raw.sort);
    if (page > 1) p.set("page", String(page));
    const s = p.toString();
    return s ? `/jobs?${s}` : "/jobs";
  };

  return (
    <>
      <form action="/jobs" className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input name="q" defaultValue={raw.q} placeholder="Search jobs, e.g. tutoring or lifeguard" aria-label="Search jobs" className="sm:flex-1" />
        <select name="category" defaultValue={raw.category ?? ""} aria-label="Category" className={selectClass}>
          <option value="">All categories</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{labelize(c)}</option>)}
        </select>
        <select name="sort" defaultValue={query.sort} aria-label="Sort by" className={selectClass}>
          {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <button type="submit" className={buttonVariants()}>Search</button>
      </form>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{result.total === 1 ? "1 job" : `${result.total} jobs`}</span>
        {!viewer && (
          <span>
            <Link href="/login?next=/jobs" className="underline underline-offset-4 hover:text-foreground">Sign in</Link> to apply and see which jobs fit your age.
          </span>
        )}
      </div>

      {items.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No jobs found</CardTitle>
            <CardDescription>
              {raw.q || raw.category ? "Try a different search or clear the filters." : "New jobs are added as our Scout agent finds them and local posters publish them. Check back soon."}
            </CardDescription>
          </CardHeader>
          {(raw.q || raw.category) && (
            <CardContent>
              <Link href="/jobs" className={buttonVariants({ variant: "outline" })}>Clear filters</Link>
            </CardContent>
          )}
        </Card>
      ) : (
        <ul className="grid gap-3">
          {items.map((job) => (
            <li key={job.id}>
              <Link href={`/jobs/${job.id}`} className="block rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
                <Card className="transition-colors hover:bg-muted/40">
                  <CardHeader>
                    <CardTitle className="text-lg">{job.title}</CardTitle>
                    <CardDescription>
                      {job.org?.name ?? job.postedBy.displayName} · {job.remote ? "Remote" : job.areaLabel}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-wrap items-center gap-2 text-sm">
                    <Badge>{formatPay(job)}</Badge>
                    <Badge variant="secondary">{labelize(job.category)}</Badge>
                    {job.schedule && <Badge variant="outline">{labelize(job.schedule)}</Badge>}
                    <Badge variant="outline">Ages {job.minAge}+</Badge>
                    {job.org?.verified && <Badge variant="outline">Verified business</Badge>}
                    {!job.eligible && <Badge variant="destructive">{job.ineligibleReason}</Badge>}
                    <span className="ml-auto text-muted-foreground">{postedAgo(job.publishedAt)}</span>
                  </CardContent>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {pages > 1 && (
        <nav className="flex items-center justify-between" aria-label="Pagination">
          {query.page > 1 ? <Link href={pageHref(query.page - 1)} className={buttonVariants({ variant: "outline" })}>← Previous</Link> : <span />}
          <span className="text-sm text-muted-foreground">Page {query.page} of {pages}</span>
          {query.page < pages ? <Link href={pageHref(query.page + 1)} className={buttonVariants({ variant: "outline" })}>Next →</Link> : <span />}
        </nav>
      )}
    </>
  );
}

function ResultsSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      <Skeleton className="h-8 w-full" />
      {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-28 w-full rounded-xl" />)}
    </div>
  );
}
