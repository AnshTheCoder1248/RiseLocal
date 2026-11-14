import { after } from "next/server";

// Background tasks without a queue. In a request, work runs via `after()` once the
// response is sent; Vercel keeps the function alive until it finishes (up to the route's
// maxDuration). Scheduled tasks are triggered by Vercel Cron → /api/cron/[task] (src/lib/cron.ts).
// Durable work isn't kept in memory: emails go through the Postgres outbox and crawls through
// checkpointed AgentCrawlItem rows, so anything `after()` doesn't finish is picked up by cron.

/** Epoch ms after which a task should stop starting new work. Cron passes it in. */
type Budget = { deadline?: number; budgetMs?: number };

export type TaskPayloads = {
  "agent:crawl": { sourceId: string } & Budget;
  "agent:schedule": Budget;
  "watch:match": { jobId: string };
  "email:deliver": Budget;
  "notify:digest": Budget;
  "jobs:expire": Budget;
};
export type TaskName = keyof TaskPayloads;

export async function runTaskNow<N extends TaskName>(name: N, data: TaskPayloads[N]) {
  const { processors } = await import("./processors");
  return (processors[name] as (d: TaskPayloads[N]) => Promise<unknown>)(data);
}

/** Schedule a task to run after the current response. Outside a request (seed, scripts), it runs immediately. */
export async function runTask<N extends TaskName>(name: N, data: TaskPayloads[N]) {
  const job = () =>
    runTaskNow(name, data).catch((err) => {
      console.error(`[task] ${name} failed`, err);
    });
  try {
    after(job);
  } catch {
    // Not inside a request scope.
    await job();
  }
}
