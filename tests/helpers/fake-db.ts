/* eslint-disable @typescript-eslint/no-explicit-any -- tests drive the untyped in-memory Prisma fake */
// A small in-memory stand-in for the Prisma client, covering just what the reliability code
// uses. The raw SQL statements (outbox claim, source claim, rate-limit upsert, cron lease) are
// implemented by matching on the statement text, with the same semantics as the real SQL.
// Each runs synchronously, so it's atomic like a single Postgres statement. Real-database
// behaviour (SKIP LOCKED, row locks under concurrency) is covered by tests/integration/*.
import { Prisma } from "@/generated/prisma/client";

type Row = Record<string, any>;
type Where = Record<string, any>;

const UNIQUE: Record<string, string[][]> = {
  emailOutbox: [["idempotencyKey"]],
  notification: [["dedupeKey"]],
  agentCrawlItem: [["runId", "position"]],
  rateLimitBucket: [["key"]],
  cronLock: [["task"]],
};
const PK: Record<string, string> = { rateLimitBucket: "key", cronLock: "task" };

const DEFAULTS: Record<string, () => Row> = {
  emailOutbox: () => ({ status: "PENDING", attempts: 0, maxAttempts: 5, nextAttemptAt: new Date(), lockedBy: null, lockedAt: null, lastError: null, sentAt: null, providerMessageId: null, createdAt: new Date(), updatedAt: new Date() }),
  agentRun: () => ({ status: "queued", startedAt: new Date(), finishedAt: null, discoveredAt: null, totalItems: null, found: 0, drafted: 0, rejected: 0, error: null }),
  agentCrawlItem: () => ({ status: "PENDING", attempts: 0, found: 0, drafted: 0, rejected: 0, tokens: 0, costUsd: 0, rejections: null, error: null, processedAt: null }),
  agentSource: () => ({ enabled: true, crawlStatus: "PENDING", nextRunAt: null, currentRunId: null, lockedBy: null, lockedAt: null, crawlAttempts: 0, lastError: null, lastRunAt: null, hints: null, createdAt: new Date() }),
  cronRun: () => ({ attempt: 1, startedAt: new Date(), finishedAt: null, durationMs: null, result: null, error: null }),
  notification: () => ({ dedupeKey: null, readAt: null, createdAt: new Date() }),
};

let seq = 0;
const newId = () => `id_${++seq}`;

const fieldRef = (name: string) => ({ __field: name });
const resolve = (row: Row, v: any) => (v && typeof v === "object" && "__field" in v ? row[v.__field] : v);
const cmp = (a: any, b: any) => (a instanceof Date ? a.getTime() : a) - (b instanceof Date ? b.getTime() : b);

function matchValue(row: Row, actual: any, cond: any): boolean {
  if (cond === null || typeof cond !== "object" || cond instanceof Date) {
    return actual instanceof Date && cond instanceof Date ? actual.getTime() === cond.getTime() : actual === cond;
  }
  if ("__field" in cond) return actual === resolve(row, cond);
  return Object.entries(cond).every(([op, raw]) => {
    const v = resolve(row, raw);
    switch (op) {
      case "equals": return v instanceof Prisma.NullTypes.DbNull || v === Prisma.DbNull ? actual == null : actual === v;
      case "not": return !matchValue(row, actual, v);
      case "in": return (v as any[]).includes(actual);
      case "notIn": return !(v as any[]).includes(actual);
      case "lt": return actual != null && cmp(actual, v) < 0;
      case "lte": return actual != null && cmp(actual, v) <= 0;
      case "gt": return actual != null && cmp(actual, v) > 0;
      case "gte": return actual != null && cmp(actual, v) >= 0;
      case "has": return Array.isArray(actual) && actual.includes(v);
      default: throw new Error(`fake-db: unsupported operator ${op}`);
    }
  });
}

export function matches(row: Row, where: Where = {}): boolean {
  return Object.entries(where).every(([k, cond]) => {
    if (k === "NOT") return !matches(row, cond);
    if (k === "OR") return (cond as Where[]).some((w) => matches(row, w));
    if (k === "AND") return (cond as Where[]).every((w) => matches(row, w));
    return matchValue(row, row[k], cond);
  });
}

function applyData(row: Row, data: Row) {
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v) && ("increment" in v || "decrement" in v)) {
      row[k] = (row[k] ?? 0) + (v.increment ?? 0) - (v.decrement ?? 0);
    } else row[k] = v;
  }
  if ("updatedAt" in row) row.updatedAt = data.updatedAt ?? new Date();
}

function sortRows(rows: Row[], orderBy?: any) {
  if (!orderBy) return rows;
  const specs = (Array.isArray(orderBy) ? orderBy : [orderBy]).flatMap((o: Row) => Object.entries(o));
  return [...rows].sort((a, b) => {
    for (const [k, dir] of specs) {
      const d = cmp(a[k] ?? -Infinity, b[k] ?? -Infinity);
      if (d) return dir === "desc" ? -d : d;
    }
    return 0;
  });
}

const uniqueError = () => new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "fake" });

export function createFakeDb() {
  const tables: Record<string, Row[]> = {};
  const table = (name: string) => (tables[name] ??= []);

  function conflicts(name: string, row: Row) {
    return (UNIQUE[name] ?? []).some((cols) =>
      table(name).some((r) => r !== row && cols.every((c) => row[c] != null && r[c] === row[c])),
    ) || table(name).some((r) => r !== row && r[PK[name] ?? "id"] === row[PK[name] ?? "id"]);
  }

  function insert(name: string, data: Row) {
    const row: Row = { ...(DEFAULTS[name]?.() ?? {}), ...(PK[name] ? {} : { id: newId() }), ...data };
    if (conflicts(name, row)) throw uniqueError();
    table(name).push(row);
    return row;
  }

  const model = (name: string) => ({
    fields: new Proxy({}, { get: (_t, k: string) => fieldRef(k) }),
    findUnique: async ({ where }: any) => table(name).find((r) => matches(r, where)) ?? null,
    findUniqueOrThrow: async ({ where }: any) => {
      const r = table(name).find((x) => matches(x, where));
      if (!r) throw new Prisma.PrismaClientKnownRequestError("Not found", { code: "P2025", clientVersion: "fake" });
      return r;
    },
    findFirst: async ({ where, orderBy }: any = {}) => sortRows(table(name).filter((r) => matches(r, where)), orderBy)[0] ?? null,
    findMany: async ({ where, orderBy, take }: any = {}) => {
      const rows = sortRows(table(name).filter((r) => matches(r, where)), orderBy);
      return take ? rows.slice(0, take) : rows;
    },
    create: async ({ data }: any) => insert(name, data),
    createMany: async ({ data, skipDuplicates }: any) => {
      let count = 0;
      for (const d of data) {
        try {
          insert(name, d);
          count++;
        } catch (e) {
          if (!skipDuplicates) throw e;
        }
      }
      return { count };
    },
    update: async ({ where, data }: any) => {
      const r = table(name).find((x) => matches(x, where));
      if (!r) throw new Prisma.PrismaClientKnownRequestError("Not found", { code: "P2025", clientVersion: "fake" });
      applyData(r, data);
      return r;
    },
    updateMany: async ({ where, data }: any) => {
      const rows = table(name).filter((r) => matches(r, where));
      rows.forEach((r) => applyData(r, data));
      return { count: rows.length };
    },
    delete: async ({ where }: any) => {
      const i = table(name).findIndex((r) => matches(r, where));
      return table(name).splice(i, 1)[0];
    },
    deleteMany: async ({ where }: any = {}) => {
      const keep = table(name).filter((r) => !matches(r, where));
      const count = table(name).length - keep.length;
      tables[name] = keep;
      return { count };
    },
    count: async ({ where }: any = {}) => table(name).filter((r) => matches(r, where)).length,
    aggregate: async ({ where, _sum }: any) => {
      const rows = table(name).filter((r) => matches(r, where));
      const sums: Row = {};
      for (const k of Object.keys(_sum ?? {})) sums[k] = rows.length ? rows.reduce((a, r) => a + (r[k] ?? 0), 0) : null;
      return { _sum: sums };
    },
  });

  async function queryRaw(strings: TemplateStringsArray, ...values: unknown[]) {
    const q = Prisma.sql(strings, ...values);
    const text = q.sql;
    const v = q.values as any[];

    if (text.includes('UPDATE "EmailOutbox"')) {
      const [workerId, now, , dueBy, limit] = v;
      const due = sortRows(table("emailOutbox").filter((r) => r.status === "PENDING" && cmp(r.nextAttemptAt, dueBy) <= 0), { nextAttemptAt: "asc" }).slice(0, Number(limit));
      for (const r of due) Object.assign(r, { status: "PROCESSING", lockedBy: workerId, lockedAt: now, attempts: r.attempts + 1, updatedAt: now });
      return due.map((r) => ({ ...r }));
    }

    if (text.includes('UPDATE "AgentSource"')) {
      const [workerId, now] = v;
      const [dueBy, staleBefore] = v.slice(-2);
      const middle = v.slice(2, -2);
      const onlyId = text.includes('AND "id" = ') ? middle.shift() : undefined;
      const exclude = middle;
      const candidates = table("agentSource").filter(
        (s) =>
          s.enabled &&
          (!onlyId || s.id === onlyId) &&
          !exclude.includes(s.id) &&
          ((s.crawlStatus !== "PROCESSING" && (s.nextRunAt == null || cmp(s.nextRunAt, dueBy) <= 0)) ||
            (s.crawlStatus === "PROCESSING" && s.lockedAt && cmp(s.lockedAt, staleBefore) < 0)),
      );
      candidates.sort((a, b) => Number(a.currentRunId == null) - Number(b.currentRunId == null) || cmp(a.nextRunAt ?? -Infinity, b.nextRunAt ?? -Infinity));
      const s = candidates[0];
      if (!s) return [];
      Object.assign(s, { crawlStatus: "PROCESSING", lockedBy: workerId, lockedAt: now });
      return [{ id: s.id }];
    }

    if (text.includes('INSERT INTO "RateLimitBucket"')) {
      const [key, resetAt, now] = v;
      let b = table("rateLimitBucket").find((r) => r.key === key);
      if (!b) table("rateLimitBucket").push((b = { key, count: 1, resetAt }));
      else if (cmp(b.resetAt, now) <= 0) Object.assign(b, { count: 1, resetAt });
      else b.count += 1;
      return [{ count: b.count, resetAt: b.resetAt }];
    }

    if (text.includes('INSERT INTO "CronLock"')) {
      const [task, runId, lockedUntil, now] = v;
      const lock = table("cronLock").find((r) => r.task === task);
      if (!lock) {
        table("cronLock").push({ task, runId, lockedUntil });
        return [{ runId }];
      }
      if (cmp(lock.lockedUntil, now) < 0) {
        Object.assign(lock, { runId, lockedUntil });
        return [{ runId }];
      }
      return [];
    }

    if (text.includes('FROM "AgentDraft"')) return []; // fuzzy duplicate lookup
    throw new Error(`fake-db: unsupported raw query: ${text.slice(0, 80)}`);
  }

  const client: any = new Proxy(
    {
      tables,
      $queryRaw: queryRaw,
      async $transaction(arg: any) {
        if (Array.isArray(arg)) return Promise.all(arg);
        const snapshot = structuredClone(tables);
        try {
          return await arg(client);
        } catch (e) {
          for (const k of Object.keys(tables)) delete tables[k];
          Object.assign(tables, snapshot);
          throw e;
        }
      },
    },
    {
      get(target: any, prop: string) {
        if (prop in target) return target[prop];
        if (typeof prop !== "string" || prop.startsWith("$") || prop === "then") return undefined;
        return (target[prop] = model(prop));
      },
    },
  );
  return client as any;
}
