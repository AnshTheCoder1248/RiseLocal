import { runCronTask, type CronOutcome } from "@/lib/cron";
import { crawlDueSources } from "./crawler";

// Scheduled group crawl, run outside Vercel by GitHub Actions (.github/workflows/scout-crawl.yml
// → scripts/crawl.ts). It reuses the checkpointed crawler and the cron run record and lock, so:
// - a run is recorded in CronRun as task "agent-schedule", like any other cron task;
// - it never overlaps another crawl run (an Actions run, a manual /api/cron/agent-schedule call);
// - whatever it doesn't finish within its budget resumes on the next run.
// It only files Scout drafts. Notifications are never sent from here: those stay on Vercel,
// delivered right away by the Postgres outbox (src/lib/outbox.ts).

export const CRAWL_TASK = "agent-schedule";
export const DEFAULT_BUDGET_MIN = 25;
const MAX_BUDGET_MIN = 300; // stays inside GitHub's 6-hour job limit with lots of room

/** Budget in minutes from user input (workflow_dispatch / env). Falls back to the default if invalid. */
export function parseBudgetMinutes(value: string | undefined | null) {
  const n = Number(value);
  if (!value?.trim() || !Number.isFinite(n) || n <= 0) return DEFAULT_BUDGET_MIN;
  return Math.min(MAX_BUDGET_MIN, Math.max(1, Math.floor(n)));
}

/** Lock lease for a run: the budget plus slack for the batch in flight and the final writes. */
export const leaseFor = (budgetMs: number) => budgetMs + 5 * 60_000;

export async function runScheduledCrawl({ budgetMs, now = Date.now() }: { budgetMs: number; now?: number }): Promise<CronOutcome> {
  return runCronTask(CRAWL_TASK, ({ deadline }) => crawlDueSources({ deadline }), {
    deadline: now + budgetMs,
    leaseMs: leaseFor(budgetMs),
  });
}

/** Process exit code: fail the Actions job only when the crawl itself failed. */
export const exitCodeFor = (outcome: Pick<CronOutcome, "status">) => (outcome.status === "FAILED" ? 1 : 0);
