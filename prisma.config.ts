import "dotenv/config";
import { defineConfig } from "prisma/config";

// The Prisma CLI (migrate, studio, db seed) uses the DIRECT connection: migrations need
// a session that Neon's PgBouncer pooler can't provide. The app itself uses the pooled
// DATABASE_URL at runtime (see src/lib/db.ts).
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "",
  },
});
