import { env } from "./env";

export type Email = { to: string; subject: string; text: string };

/** A send failure. `retryable` is false for errors a retry can't fix (bad address, rejected payload). */
export class EmailSendError extends Error {
  constructor(
    message: string,
    public retryable: boolean,
  ) {
    super(message);
  }
}

export type SendOptions = {
  /** Forwarded to the provider so a retried request is never delivered twice. */
  idempotencyKey?: string;
};

export type EmailSender = (email: Email, opts?: SendOptions) => Promise<{ id: string | null }>;

/**
 * Sends one email through Resend's HTTP API when EMAIL_API_KEY is set.
 * Without a key (local dev), the email is logged to the console instead.
 * Application code shouldn't call this directly. Use enqueueEmail() (src/lib/outbox.ts),
 * which persists the email and retries delivery.
 */
export const sendEmail: EmailSender = async ({ to, subject, text }, opts = {}) => {
  const { EMAIL_API_KEY, EMAIL_FROM } = env();
  if (!EMAIL_API_KEY) {
    console.info(`[email:dev] to=${to} subject="${subject}"\n${text}\n`);
    return { id: null };
  }
  let res: Response;
  try {
    res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${EMAIL_API_KEY}`,
        "Content-Type": "application/json",
        ...(opts.idempotencyKey && { "Idempotency-Key": opts.idempotencyKey }),
      },
      body: JSON.stringify({ from: EMAIL_FROM, to, subject, text }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    throw new EmailSendError(`Email request failed: ${(err as Error).message}`, true); // network / timeout
  }
  if (!res.ok) {
    // 429 (rate limited), 409 (concurrent idempotent request) and 5xx are transient.
    const retryable = res.status === 429 || res.status === 409 || res.status >= 500;
    throw new EmailSendError(`Email send failed: ${res.status} ${(await res.text().catch(() => "")).slice(0, 500)}`, retryable);
  }
  const body = (await res.json().catch(() => ({}))) as { id?: string };
  return { id: body.id ?? null };
};
