import type { NextRequest } from "next/server";
import { handler, json, notFound, unauthorized } from "@/lib/api";
import { CRON_TASKS, isAuthorizedCron, runCronTask } from "@/lib/cron";

// Scheduled tasks, triggered by Vercel Cron (see vercel.json). Vercel sends
// `Authorization: Bearer $CRON_SECRET` when CRON_SECRET is set on the project. Every
// invocation is recorded in CronRun, and overlapping invocations of a task are skipped
// (src/lib/cron.ts).
export const maxDuration = 300; // keep in sync with CRON_MAX_DURATION_S

export const GET = handler(async (req: NextRequest, ctx: RouteContext<"/api/cron/[task]">) => {
  if (!isAuthorizedCron(req.headers.get("authorization"))) {
    if (!process.env.CRON_SECRET && process.env.NODE_ENV !== "development") console.error("[cron] CRON_SECRET is not set; refusing cron request");
    throw unauthorized("Invalid cron secret");
  }
  const { task } = await ctx.params;
  const fn = Object.hasOwn(CRON_TASKS, task) ? CRON_TASKS[task] : undefined;
  if (!fn) throw notFound("Unknown task");

  const outcome = await runCronTask(task, fn);
  // A 500 makes the failure show up in Vercel's cron logs. The error itself is in CronRun.
  return json({ ok: outcome.status !== "FAILED", ...outcome, result: outcome.result ?? null }, outcome.status === "FAILED" ? 500 : 200);
});
