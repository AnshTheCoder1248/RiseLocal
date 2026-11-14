// One-command setup (NFR-OPS): `npm run setup`
// Creates .env with fresh secrets, then (once Neon URLs are filled in) migrates and seeds.
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import "dotenv/config";

const run = (cmd) => execSync(cmd, { stdio: "inherit" });
const secret = () => randomBytes(32).toString("base64url");

if (!existsSync(".env")) {
  const env = readFileSync(".env.example", "utf8")
    .replace('AUTH_SECRET=""', `AUTH_SECRET="${secret()}"`)
    .replace('TOKEN_SECRET=""', `TOKEN_SECRET="${secret()}"`)
    .replace('CERT_SIGNING_SECRET=""', `CERT_SIGNING_SECRET="${secret()}"`)
    .replace('CRON_SECRET=""', `CRON_SECRET="${secret()}"`);
  writeFileSync(".env", env);
  console.info("Created .env with generated secrets.");
}

const { DATABASE_URL = "", DIRECT_URL = "" } = process.env;
if (!DATABASE_URL || DATABASE_URL.includes("ep-xxxx") || !DIRECT_URL || DIRECT_URL.includes("ep-xxxx")) {
  console.info("\nNext: paste your Neon pooled + direct connection strings into DATABASE_URL and DIRECT_URL in .env, then run `npm run setup` again.");
  process.exit(0);
}

run("npx prisma migrate deploy");
if (!process.argv.includes("--no-seed")) run("npx prisma db seed");
console.info("\nReady. Start the app with `npm run dev`. Trigger a scheduled task locally with: curl localhost:3000/api/cron/jobs-expire");
