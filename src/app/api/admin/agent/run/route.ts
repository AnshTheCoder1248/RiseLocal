import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { handler, json, parseBody } from "@/lib/api";
import { runAgentSchema } from "@/lib/validation/misc";
import { requireUser } from "@/lib/auth/session";
import { runTask } from "@/lib/tasks";
import { audit } from "@/lib/audit";
import { CRAWL } from "@/lib/agent/crawler";

// A crawl runs after the response, within this route's time limit. Whatever doesn't fit
// is checkpointed and finished by the agent-schedule cron.
export const maxDuration = 300;

// POST /api/admin/agent/run — "Run now" for a source (AG-2).
export const POST = handler(async (req: Request) => {
  const admin = await requireUser({ roles: ["ADMIN"] });
  const { sourceId } = await parseBody(req, runAgentSchema);
  const source = await db.agentSource.findUniqueOrThrow({ where: { id: sourceId } });
  const current = source.currentRunId ? await db.agentRun.findUnique({ where: { id: source.currentRunId } }) : null;
  const inFlight = current && current.status !== "succeeded" && current.status !== "failed" ? current : null;

  // Another execution holds the source: report its run instead of starting a second one.
  const leaseLive = source.crawlStatus === "PROCESSING" && source.lockedAt && Date.now() - source.lockedAt.getTime() < CRAWL.leaseMs;
  if (leaseLive) {
    const run = inFlight ?? (await db.agentRun.findFirst({ where: { sourceId }, orderBy: { startedAt: "desc" } }));
    return json({ run, alreadyRunning: true }, 202);
  }

  // Resume an unfinished run (its checkpoint is kept), or queue a new one.
  let run = inFlight;
  if (!run) {
    run = await db.agentRun.create({ data: { sourceId, status: "queued", model: env().LLM_MODEL, promptVer: env().AGENT_PROMPT_VERSION } });
  }
  // Compare-and-set on currentRunId, so two quick clicks can't both attach a run.
  const { count } = await db.agentSource.updateMany({
    where: { id: sourceId, currentRunId: source.currentRunId, crawlStatus: { not: "PROCESSING" } },
    data: { currentRunId: run.id, crawlStatus: "PENDING", nextRunAt: null, crawlAttempts: 0 },
  });
  if (!count) {
    if (run !== inFlight) await db.agentRun.delete({ where: { id: run.id } });
    const latest = await db.agentRun.findFirst({ where: { sourceId }, orderBy: { startedAt: "desc" } });
    return json({ run: latest, alreadyRunning: true }, 202);
  }

  await runTask("agent:crawl", { sourceId, budgetMs: 250_000 });
  await audit(admin.id, "agent.run", "agent_source", sourceId, { runId: run.id, resumed: run === inFlight });
  return json({ run, resumed: run === inFlight }, 202);
});
