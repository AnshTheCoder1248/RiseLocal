// Scheduled Scout group crawl, run by GitHub Actions (.github/workflows/scout-crawl.yml).
// Locally: `npm run crawl` (uses DATABASE_URL from .env). Budget: CRAWL_BUDGET_MINUTES (default 25).
import "dotenv/config";
import { appendFileSync } from "node:fs";
import { db } from "@/lib/db";
import { exitCodeFor, parseBudgetMinutes, runScheduledCrawl } from "@/lib/agent/worker";

async function main() {
  const minutes = parseBudgetMinutes(process.env.CRAWL_BUDGET_MINUTES);
  console.info(`[crawl] starting with a ${minutes}-minute budget`);

  const outcome = await runScheduledCrawl({ budgetMs: minutes * 60_000 });
  const secs = Math.round(outcome.durationMs / 1000);
  console.info(`[crawl] ${outcome.status} in ${secs}s`, JSON.stringify(outcome.result ?? outcome.error ?? null));

  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `### Scout crawl: ${outcome.status}\n\n- Run: \`${outcome.runId}\`\n- Duration: ${secs}s\n` +
        (outcome.status === "SKIPPED" ? "- Another crawl run held the lock, so this one did nothing.\n" : "") +
        "\n```json\n" + JSON.stringify(outcome.result ?? { error: outcome.error }, null, 2) + "\n```\n",
    );
  }
  return exitCodeFor(outcome);
}

main()
  .catch((err) => {
    // runScheduledCrawl records task errors itself; this catches setup failures (e.g. no DB connection).
    console.error("[crawl] could not run", err);
    return 1;
  })
  .then(async (code) => {
    await db.$disconnect().catch(() => {});
    process.exit(code);
  });
