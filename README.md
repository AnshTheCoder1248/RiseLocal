# RiseLocal

A local-first jobs marketplace for 13–18 year olds. An AI agent crawls and normalizes real openings, employers manage AI-surfaced listings, neighbors post gigs like tutoring, lawn mowing and snow removal, and students filter, watch, and get notified the moment the right job appears.

**Stack:** Next.js 16 (App Router) · TypeScript · Neon Postgres + Prisma 7 · Auth.js (NextAuth v5) · Vercel Cron + GitHub Actions · Tailwind CSS v4 + shadcn/ui · Zod · Vitest

## Architecture

| Service | Runs | Why |
| --- | --- | --- |
| **Vercel** | Frontend and all backend APIs (`src/app`), the notification worker (outbox delivery right after each request through `after()`, plus the `email-outbox` cron), and the short daily maintenance crons | Request-driven work that must be fast, close to users, and inside the 300-second function limit |
| **GitHub Actions** | Scheduled Scout group crawls (`.github/workflows/scout-crawl.yml` → `scripts/crawl.ts`) | Long batch work: a run can crawl for 25+ minutes instead of 4, and it doesn't need Vercel Pro for an hourly schedule |
| **PostgreSQL (Neon)** | All persistent state, including the notification outbox, crawl checkpoints, rate limits, and cron run records and locks | The only infrastructure dependency: no Redis, no queue |

Time-sensitive notifications never wait for a crawl or a schedule. A guardian consent link, an application update or a watch alert is written to the outbox in the same transaction as the change, then delivered from the same Vercel request right after the response. The `email-outbox` cron only handles retries and recovery. The crawl worker only files Scout drafts and never sends notifications. Alerts for an approved draft go out through the normal publish → watch match → outbox path on Vercel.

## Quick start

Requires Node 22+ and a [Neon](https://neon.tech) project.

1. In Neon, create a project (or a `dev` branch of it) and open **Connect**. Copy both the **pooled** connection string (host contains `-pooler`) and the **direct** one.
2. Run:

```bash
npm install
npm run setup     # first run creates .env with generated secrets
```

3. Paste the pooled string into `DATABASE_URL` and the direct string into `DIRECT_URL` in `.env`, then:

```bash
npm run setup     # migrates + seeds Neon
npm run dev       # http://localhost:3000
curl localhost:3000/api/cron/jobs-expire   # optional: run a scheduled task by hand
```

All seed accounts are `*@riselocal.local` and share the password in `prisma/seed.ts`:
`priya` (admin), `rosa` / `sam` (verified employers), `bean` (employer, verification pending), `dev` / `alex` (community), `maya` (15, guardian approval on), `jordan` (17), and `leo` (14, waiting for guardian consent).

Background work (watch alerts, email delivery, "Run now" crawls) starts after the response with Next's `after()`. Anything durable is first written to Postgres (the email outbox and crawl checkpoints), so the `email-outbox` cron (Vercel) and the crawl workflow (GitHub Actions) finish whatever `after()` doesn't. Without `EMAIL_API_KEY`, emails are printed to the server console.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` / `build` / `start` | Next.js |
| `npm run db:migrate` | `prisma migrate dev` (create a new migration after editing the schema) |
| `npm run db:deploy` / `db:seed` / `db:studio` | Apply migrations, seed, open Prisma Studio |
| `npm test` / `typecheck` / `lint` | Vitest, tsc, ESLint |
| `npm run crawl` | Run a Scout group crawl locally against `DATABASE_URL` (what the GitHub workflow runs). Budget: `CRAWL_BUDGET_MINUTES`, default 25 |

### Tests

`npm test` runs the unit tests. Postgres-backed code (outbox, crawler, rate limits, cron locks) is tested against an in-memory Prisma fake (`tests/helpers/fake-db.ts`), so no database is needed.

`tests/integration/` runs the same SQL against a real Postgres, covering concurrent claims, `SKIP LOCKED`, atomic upserts and lock races. It's skipped unless `TEST_DATABASE_URL` is set. Point it at a **throwaway** database, such as a Neon branch:

```bash
DATABASE_URL=$TEST_DATABASE_URL DIRECT_URL=$TEST_DATABASE_URL npx prisma migrate deploy
TEST_DATABASE_URL=postgresql://… npm test
```

## Layout

```
src/app/api/        Route handlers (REST surface from spec §13)
src/lib/auth/       Auth.js config, age rules, session + role guards
src/lib/safety/     Content filter + teen-suitability rules, 3-part publish gate
src/lib/jobs/       Board search (tsvector + pg_trgm), watch matching, job lifecycle
src/lib/agent/      Scout pipeline: discover → extract → classify → dedupe & file; crawler.ts = checkpointed batches
src/lib/tasks/      Background tasks (after()) + task processors
src/lib/outbox.ts   Transactional email outbox: enqueue, deliver, retry, recover
src/lib/cron.ts     Cron auth, run records (CronRun), overlap lock (CronLock), failed-task retry
src/lib/rate-limit.ts  Postgres-backed rate limits + per-endpoint policies
src/lib/certs/      Certificate codes + HMAC signatures
src/lib/validation/ Shared Zod schemas
src/components/ui/  shadcn/ui components
prisma/             schema.prisma, migrations (incl. search trigger), seed.ts
scripts/setup.mjs   One-command setup (.env secrets → migrate → seed)
scripts/crawl.ts    Scout group-crawl worker (run by GitHub Actions)
.github/workflows/  scout-crawl.yml: hourly crawl schedule
vercel.json         Vercel Cron schedules → /api/cron/[task] (outbox, retries, daily maintenance)
tests/              Unit tests (age gate, safety, watch match, Scout, tokens/certs, outbox, crawler, rate limits, cron)
tests/integration/  Same reliability code against a real Postgres (needs TEST_DATABASE_URL)
```

## API

Every route re-reads the user from the database for role and status checks, and validates input with Zod.

| Method | Path | Who |
| --- | --- | --- |
| POST | `/api/auth/signup` | public: role + DOB, age gate, guardian email for 13–15 |
| GET/POST | `/api/auth/[...nextauth]` | Auth.js (credentials + Google sign-in for existing accounts) |
| POST | `/api/guardian/consent` · `/api/guardian/approve` | signed guardian links |
| GET / POST | `/api/jobs` | board query / create job or gig (`publish: true` runs the gate) |
| GET / PATCH / DELETE | `/api/jobs/:id` | detail + trust signals / edit + `action` (publish, pause, resume, fill, reopen) / archive (`?hard=true` purges) |
| POST | `/api/jobs/:id/apply` | student, guardian gate for 13–15 |
| POST / DELETE | `/api/jobs/:id/save` | bookmark |
| POST | `/api/jobs/:id/certificate` | issuer, completed + confirmed engagement only |
| GET / PATCH | `/api/applications`, `/api/applications/:id` | student list / poster pipeline, move / withdraw / complete |
| GET / POST / PATCH / DELETE | `/api/watches`, `/api/watches/:id` | student |
| GET / PATCH | `/api/notifications` | inbox / mark read |
| POST | `/api/reports` | any user |
| GET / PATCH | `/api/certificates`, `/api/certificates/:id` | wallet / visibility or revoke |
| GET | `/api/verify/:code` | public, minimal fields |
| GET / PATCH | `/api/employer/drafts`, `/api/employer/drafts/:id` | Scout drafts: approve / dismiss |
| GET / POST | `/api/employer/org` | business verification request |
| GET / PATCH | `/api/profile` | student profile |
| GET / POST, GET / PATCH / DELETE | `/api/admin/agent/sources`, `/api/admin/agent/sources/:id` | admin |
| POST | `/api/admin/agent/run` | admin "Run now" |
| GET / POST | `/api/admin/moderation` | admin queues + triage |
| GET | `/api/cron/[task]` | Vercel Cron only (`email-outbox`, `retry-failed`, `jobs-expire`, `notify-digest`; `agent-schedule` as a manual fallback for the GitHub crawl), with `CRON_SECRET` as a Bearer token |

## Database connections

- **`DATABASE_URL`**: Neon's **pooled** URL. The app uses it through Prisma's Neon adapter (`@prisma/adapter-neon`), which suits Vercel's short-lived functions.
- **`DIRECT_URL`**: the **direct** URL. Migrations (`prisma migrate`) and the seed use it, because migrations need a session connection the pooler can't provide.
- Any non-Neon Postgres URL (for CI or a local container) falls back to `node-postgres` automatically (`src/lib/db.ts`).

## Deploying (Vercel + GitHub Actions + Neon)

1. **Neon:** use the `main` branch for production and separate branches for dev and previews.
2. **Vercel:** import the repo and set the env vars from `.env.example` (`DATABASE_URL` pooled, `DIRECT_URL` direct, `AUTH_SECRET`, `TOKEN_SECRET`, `CERT_SIGNING_SECRET`, `CRON_SECRET`, `APP_URL`, `EMAIL_API_KEY`, and the Google OAuth keys). `postinstall` runs `prisma generate`.
3. **Migrations:** run `npm run db:deploy` with the production `DIRECT_URL` before or as part of a release, for example from a CI step on `main`. Don't run it in every Vercel build, or preview deployments will migrate production.
4. **`CRON_SECRET` is required in production.** Without it every `/api/cron/*` request is rejected (401). Only `next dev` accepts unauthenticated cron calls.
5. **Vercel Cron:** `vercel.json` schedules four tasks (times are UTC):
   - `email-outbox`, every 5 minutes: delivers queued emails, retries failures with backoff, and recovers interrupted sends.
   - `retry-failed`, hourly at :30: re-runs `jobs-expire` / `notify-digest` if their last run failed or was interrupted, up to 3 attempts.
   - `jobs-expire`, daily at 08:00: expires jobs, prunes stale drafts, purges archived jobs, and prunes old outbox, cron-run, rate-limit and crawl-item rows.
   - `notify-digest`, daily at 22:00: daily watch digests, sent through the outbox.

   The **Hobby plan only allows once-a-day crons**, and a deploy with sub-daily schedules fails there. On Hobby, make `email-outbox` and `retry-failed` daily: emails still go out right after each request through `after()`, but a failed send then waits up to a day for its retry. Pro is recommended for that reason. Crawling no longer depends on the Vercel plan.
6. **GitHub Actions (Scout crawls):** in the repo's **Settings → Secrets and variables → Actions**, add:
   - Secret `DATABASE_URL`: the production **pooled** Neon URL (the same value as on Vercel).
   - Secret `LLM_API_KEY` and variable `LLM_MODEL`, once LLM extraction is wired in. Optional variables: `AGENT_PROMPT_VERSION`, `SUITABILITY_REJECT_BELOW`.

   The workflow runs hourly at :17, and **Actions → Scout crawl → Run workflow** starts one by hand with a custom budget (1–300 minutes). Each run crawls due sources for up to 25 minutes (job timeout 35), checkpointing as it goes. A run that finds nothing due exits in seconds. Runs never overlap: the workflow's `concurrency` group and the Postgres `CronLock` both enforce this, and a run that finds the lock held exits as `SKIPPED`. Crawl runs show up in `CronRun` as task `agent-schedule`, next to the Vercel tasks. A failed crawl turns the workflow run red, with a summary on the run page.

   GitHub only runs scheduled workflows on the default branch, and pauses them after 60 days without repository activity. Each run costs Actions minutes (about 2 minutes when nothing is due). On a private repo's free tier, hourly runs use roughly 1,500 of the 2,000 monthly minutes, so switch the schedule to every 2–3 hours if needed: sources still crawl on their own cadence.

## Reliability without a queue

Postgres is the only infrastructure. There's no Redis and no BullMQ. Each piece is built to survive a Vercel function being killed at any point.

**Email outbox** (`EmailOutbox`, `src/lib/outbox.ts`)
- `enqueueEmail()` writes the email in the same transaction as the change that triggers it. Guardian consent and approval emails commit together with the account or application. Use `emailGuardian(…, { tx })` or `notify(…, { email })`, never `sendEmail()` directly.
- Every email has an **idempotency key** (e.g. `guardian-consent:<userId>`, `digest:<studentId>:<date>`), and re-enqueueing the same key does nothing. Resend also gets a per-row `Idempotency-Key`, so a send interrupted after the provider accepted it isn't delivered twice on retry.
- Statuses are `PENDING` → `PROCESSING` → `SENT`, or `FAILED`. Senders claim rows with `FOR UPDATE SKIP LOCKED`, so concurrent senders never share a row. Transient errors (network, 429, 5xx) are retried with exponential backoff (about 1, 2, 4 and 8 minutes, ±20%) up to **5 attempts**. Non-retryable errors (e.g. 422 invalid address) fail immediately.
- A row stuck in `PROCESSING` for more than 10 minutes (the function died mid-send) is put back to `PENDING`, or `FAILED` if that was its last attempt.
- Permanent failures are logged as `[email:failed] {"outboxId":…,"reason":"max_attempts"|"non_retryable"|"interrupted",…}` with the address masked, and stay in the table:
  `SELECT id, "to", "lastError", attempts FROM "EmailOutbox" WHERE status = 'FAILED' ORDER BY "updatedAt" DESC;`
  To resend one, set `status='PENDING', attempts=0, "nextAttemptAt"=now()`.

**Scout crawling** (`AgentSource.crawlStatus`, `AgentCrawlItem`, `src/lib/agent/crawler.ts`)
- A crawl execution (the GitHub workflow, admin "Run now" on Vercel, or a manual `/api/cron/agent-schedule` call) claims one source at a time (`PENDING` / due `COMPLETED` / due `FAILED` → `PROCESSING`) with `FOR UPDATE SKIP LOCKED` plus a 6-minute lease (`lockedBy` / `lockedAt`), renewed before every item. Two executions can never crawl the same source. Every write checks `lockedBy`, so an execution that lost its lease stops instead of overwriting.
- Checkpoint 1: `discover()` output is saved as `AgentCrawlItem` rows, so a resumed run never re-fetches. Checkpoint 2: items are processed in batches of 10, and each item's drafts and its `DONE` mark commit in one transaction. An item is filed at most once, and drafts are also deduped by fingerprint.
- An execution stops starting work when its budget runs out: 25 minutes on GitHub Actions, or 250 seconds on Vercel ("Run now", where `maxDuration` is 300s). The source goes back to `PENDING` with its run in progress, and the next execution resumes at the first unfinished item. A "Run now" too big for one Vercel function is finished by the next scheduled GitHub run.
- A failing item is retried up to 3 times, then marked `FAILED` without blocking the run. A failing source (e.g. fetch error) is retried after 15 and then 30 minutes (±20%). After 3 failures it waits for its next regular cadence.

**Rate limiting** (`RateLimitBucket`, `src/lib/rate-limit.ts`)
- Fixed-window counters shared by every instance. Each hit is a single `INSERT … ON CONFLICT DO UPDATE … RETURNING`, so concurrent requests can't race past the limit. Keys are SHA-256 hashes, so no raw IPs or emails are stored.
- Policies (`LIMITS`):

  | Endpoint | Limits |
  | --- | --- |
  | Login (credentials) | 5 per 15 min per IP + email, 50 per 15 min per IP |
  | Signup | 10/hour per IP, 3/hour per email |
  | Guardian consent / approve | 20/hour per IP |
  | Job posting | 10/hour and 30/day per user (admins exempt) |
  | Apply | 20/day per student |
  | Reports | 20/hour per user |
  | Password reset | policy ready (10/hour per IP, 3/hour per email); the endpoint isn't built yet |

  Browsing (GET routes) isn't limited. Over-limit requests get `429` with `Retry-After`. A blocked login shows `?error=CredentialsSignin&code=rate_limited`. If the limiter's database check errors, the request is allowed and the error is logged.

**Cron runs** (`CronRun`, `CronLock`, `src/lib/cron.ts`)
- Every invocation is recorded with its status (`RUNNING`, `SUCCEEDED`, `FAILED`, `SKIPPED`), start and finish time, duration, result and error.
- A lease row in `CronLock` stops executions of the same task from overlapping. The second one is recorded as `SKIPPED`. A crashed execution's lease expires after 330 seconds, and the next run marks the dead one `FAILED` ("Interrupted").
- Failed runs return HTTP 500, so they show in Vercel's cron logs. Recent runs:
  `SELECT task, status, attempt, "startedAt", "durationMs", error FROM "CronRun" ORDER BY "startedAt" DESC LIMIT 50;`

**Remaining trade-offs:** delivery latency on a retry is bounded by the `email-outbox` schedule (5 minutes on Pro). GitHub's scheduled runs can start late under load (sometimes by 10–30 minutes), which is fine for crawls but is why notifications don't run there. The crawl worker connects to the database from outside Vercel, so its `DATABASE_URL` is a second place to rotate when you change the password. Timestamps assume the database session runs in UTC, which is the default on Neon.

## Not built yet

- **LLM extraction** (`src/lib/agent/extract.ts` → `llmExtract`): stubbed. Free-text sources are quarantined until a provider is wired in. JSON API sources with a `fieldMap` hint already work.
- **Email verification** for new adult accounts (AUTH-4), 2FA, and "log out everywhere".
- **UI screens** beyond the landing page (board, dashboards, admin console).
- **Password reset** flow (the rate-limit policy `LIMITS.passwordReset` is ready for it).
- An admin view for failed outbox emails and cron runs (query the tables for now; see above).
- Certificate PDF + QR rendering, push notifications, Playwright crawling for JS-rendered pages.
