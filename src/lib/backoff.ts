/**
 * Exponential backoff with ±20% jitter: base, 2×base, 4×base, … capped at maxMs.
 * `attempt` is the number of attempts already made (1 = first failure).
 */
export function backoffMs(attempt: number, { baseMs = 30_000, maxMs = 60 * 60_000, random = Math.random } = {}) {
  const exp = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
  return Math.round(exp * (0.8 + 0.4 * random()));
}

/** Short, single-line error text safe to store in a TEXT column and logs. */
export function errorText(err: unknown, max = 1000) {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.replace(/\s+/g, " ").slice(0, max);
}
