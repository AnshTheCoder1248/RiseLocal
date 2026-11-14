import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1), // pooled (Neon "-pooler" host) — used by the app
  DIRECT_URL: z.string().optional(), // direct — used by the Prisma CLI for migrations
  CRON_SECRET: z.string().min(16).optional(), // Vercel sends it as a Bearer token to /api/cron/*
  AUTH_SECRET: z.string().min(16).optional(),
  AUTH_GOOGLE_ID: z.string().optional(),
  AUTH_GOOGLE_SECRET: z.string().optional(),
  APP_URL: z.string().url().default("http://localhost:3000"),
  TOKEN_SECRET: z.string().min(16).default("dev-only-token-secret-change-me"),
  CERT_SIGNING_SECRET: z.string().min(16).default("dev-only-cert-secret-change-me"),
  EMAIL_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default("RiseLocal <no-reply@riselocal.local>"),
  LLM_API_KEY: z.string().optional(),
  LLM_MODEL: z.string().optional(),
  AGENT_PROMPT_VERSION: z.string().default("extract-v1"),
  SUITABILITY_REJECT_BELOW: z.coerce.number().min(0).max(1).default(0.65),
  FEATURE_AGENT_AUTO_PUBLISH: z.stringbool().default(false),
  FEATURE_PUSH_NOTIFICATIONS: z.stringbool().default(false),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/** Parsed, typed environment. Parsed lazily so `next build` works without a full .env. */
export function env(): Env {
  if (!cached) {
    cached = schema.parse(process.env);
    if (process.env.NODE_ENV === "production") {
      for (const key of ["TOKEN_SECRET", "CERT_SIGNING_SECRET"] as const) {
        if (cached[key].startsWith("dev-only")) throw new Error(`${key} must be set in production`);
      }
    }
  }
  return cached;
}
