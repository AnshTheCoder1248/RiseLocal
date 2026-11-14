import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { notify } from "@/lib/notifications";
import { deliverOutbox, enqueueEmail } from "@/lib/outbox";
import { matchesFilters } from "@/lib/jobs/match";
import { boardFilterSchema } from "@/lib/validation/jobs";
import { ageOn } from "@/lib/auth/age";
import { crawlDueSources, crawlSourceNow } from "@/lib/agent/crawler";
import type { TaskName, TaskPayloads } from "./index";

type Processors = { [N in TaskName]: (data: TaskPayloads[N]) => Promise<unknown> };

/** Default budget when no deadline is passed: well under the 300s route maxDuration. */
const DEFAULT_BUDGET_MS = 250_000;
const deadlineOf = ({ deadline, budgetMs }: { deadline?: number; budgetMs?: number }) => deadline ?? Date.now() + (budgetMs ?? DEFAULT_BUDGET_MS);

const fmtPay = (cents: number | null) => (cents == null ? "" : `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`);

export const processors: Processors = {
  // "Run now" for one source. A no-op if another execution is already crawling it.
  "agent:crawl": (data) => crawlSourceNow(data.sourceId, { deadline: deadlineOf(data) }),

  // Crawl due sources, resuming interrupted runs first, in checkpointed batches within the
  // budget (AG-2). Anything unfinished resumes on the next cron run. One failing source
  // doesn't stop the rest. See src/lib/agent/crawler.ts.
  "agent:schedule": (data) => crawlDueSources({ deadline: deadlineOf(data) }),

  // Deliver due outbox emails: retries with backoff, and recovers interrupted sends.
  "email:deliver": (data) => deliverOutbox({ deadline: deadlineOf(data) }),

  // Evaluate a newly published job against all active watches (WA-6).
  "watch:match": async ({ jobId }) => {
    const job = await db.job.findUnique({ where: { id: jobId }, include: { org: { select: { verified: true } } } });
    if (!job || job.status !== "PUBLISHED" || job.moderationHold) return;
    const watches = await db.watch.findMany({
      where: { active: true },
      include: { student: { select: { id: true, dateOfBirth: true, status: true } } },
    });
    for (const w of watches) {
      if (w.student.status !== "ACTIVE") continue;
      const filters = boardFilterSchema.safeParse(w.filters);
      if (!filters.success) continue;
      const age = w.student.dateOfBirth ? ageOn(w.student.dateOfBirth) : undefined;
      if (age != null && job.minAge > age) continue; // never alert on jobs they can't take
      if (!matchesFilters({ ...job, orgVerified: job.org?.verified }, filters.data, age)) continue;

      const pay = job.payType === "VOLUNTEER" ? "Volunteer" : `${fmtPay(job.payMin ?? job.payMax)}${job.payType === "HOURLY" ? "/hr" : ""}`;
      const instantEmail = w.frequency === "instant" && w.channels.includes("email");
      await notify(
        w.studentId,
        "watch_match",
        { watchId: w.id, watchName: w.name, jobId: job.id, title: job.title, pay, area: job.areaLabel },
        {
          dedupeKey: `watch:${w.id}:${job.id}`,
          email: instantEmail
            ? { subject: `New match: ${job.title}`, text: `A new job matches your watch "${w.name}": ${job.title} · ${pay} · ${job.areaLabel}\n${env().APP_URL}/jobs/${job.id}` }
            : undefined,
        },
      );
      await db.watch.update({ where: { id: w.id }, data: { lastMatchedAt: new Date() } });
    }
  },

  // Daily digest for watches set to "daily" with the email channel (WA-3). Emails go through
  // the outbox with a per-student, per-day key, so a re-run after a failure never double-sends.
  "notify:digest": async (data) => {
    const since = new Date(Date.now() - 864e5);
    const day = new Date().toISOString().slice(0, 10);
    let queued = 0;
    const watches = await db.watch.findMany({
      where: { active: true, frequency: "daily", channels: { has: "email" }, lastMatchedAt: { gte: since } },
      include: { student: { select: { id: true, email: true } } },
    });
    const byStudent = new Map<string, { email: string; watchIds: string[] }>();
    for (const w of watches) {
      const entry = byStudent.get(w.studentId) ?? { email: w.student.email, watchIds: [] };
      entry.watchIds.push(w.id);
      byStudent.set(w.studentId, entry);
    }
    for (const [studentId, { email }] of byStudent) {
      const matches = await db.notification.findMany({
        where: { userId: studentId, kind: "watch_match", createdAt: { gte: since } },
        orderBy: { createdAt: "desc" },
        take: 20,
      });
      if (!matches.length) continue;
      const lines = matches.map((m) => {
        const p = m.payload as { title?: string; pay?: string; area?: string; jobId?: string };
        return `• ${p.title} · ${p.pay} · ${p.area}\n  ${env().APP_URL}/jobs/${p.jobId}`;
      });
      const r = await enqueueEmail({
        to: email,
        subject: `Your RiseLocal daily digest (${matches.length} new)`,
        text: lines.join("\n"),
        idempotencyKey: `digest:${studentId}:${day}`,
      });
      if (r.enqueued) queued++;
    }
    const delivery = queued ? await deliverOutbox({ deadline: Math.min(deadlineOf(data), Date.now() + 60_000) }) : null;
    return { students: byStudent.size, queued, delivery };
  },

  // Nightly sweep: expire ended/idle jobs, prune stale agent drafts (§05, AG-7).
  "jobs:expire": async () => {
    const now = new Date();
    const idleCutoff = new Date(now.getTime() - 60 * 864e5);
    const expired = await db.job.updateMany({
      where: { status: "PUBLISHED", OR: [{ expiresAt: { lt: now } }, { publishedAt: { lt: idleCutoff }, expiresAt: null }] },
      data: { status: "EXPIRED" },
    });
    const staleCutoff = new Date(now.getTime() - 14 * 864e5);
    const stale = await db.agentDraft.updateMany({
      where: { reviewState: "pending", lastSeenAt: { lt: staleCutoff } },
      data: { reviewState: "dismissed" },
    });
    await db.job.updateMany({
      where: { source: "AGENT", status: "DRAFT", agentDraft: { reviewState: "dismissed" } },
      data: { status: "ARCHIVED", archivedAt: now },
    });
    // Hard-delete archived jobs past the 30-day restore window with no certificates attached (EMP-5).
    const purgeCutoff = new Date(now.getTime() - 30 * 864e5);
    const purgeable = await db.job.findMany({
      where: { status: "ARCHIVED", archivedAt: { lt: purgeCutoff }, certificates: { none: {} } },
      select: { id: true },
    });
    for (const { id } of purgeable) {
      await db.$transaction([
        db.application.deleteMany({ where: { jobId: id } }),
        db.agentDraft.updateMany({ where: { jobId: id }, data: { jobId: null } }),
        db.job.delete({ where: { id } }),
      ]);
    }

    // Retention for the reliability tables.
    const [outboxSent, outboxFailed, buckets, cronRuns, crawlItems] = await Promise.all([
      db.emailOutbox.deleteMany({ where: { status: "SENT", sentAt: { lt: new Date(now.getTime() - 30 * 864e5) } } }),
      db.emailOutbox.deleteMany({ where: { status: "FAILED", updatedAt: { lt: new Date(now.getTime() - 90 * 864e5) } } }),
      db.rateLimitBucket.deleteMany({ where: { resetAt: { lt: new Date(now.getTime() - 36e5) } } }),
      db.cronRun.deleteMany({ where: { startedAt: { lt: new Date(now.getTime() - 30 * 864e5) } } }),
      // Item payloads are large. Keep them only for a week after their run finishes.
      db.agentCrawlItem.deleteMany({ where: { run: { finishedAt: { lt: new Date(now.getTime() - 7 * 864e5) } } } }),
    ]);
    return {
      expired: expired.count, staleDrafts: stale.count, purged: purgeable.length,
      pruned: { outbox: outboxSent.count + outboxFailed.count, rateLimitBuckets: buckets.count, cronRuns: cronRuns.count, crawlItems: crawlItems.count },
    };
  },
};
