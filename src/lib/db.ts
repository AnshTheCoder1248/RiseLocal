import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * Neon (production): serverless driver over WebSockets with the pooled connection string,
 * which suits Vercel's short-lived functions. Any other Postgres URL (CI, a local
 * container) falls back to node-postgres.
 */
export function createPrismaClient(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  const isNeon = new URL(connectionString).hostname.endsWith(".neon.tech");
  const adapter = isNeon ? new PrismaNeon({ connectionString }) : new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

export const db = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
