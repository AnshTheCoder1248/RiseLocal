import type { PayType } from "@/generated/prisma/client";

const dollars = (cents: number) => {
  const d = cents / 100;
  return `$${Number.isInteger(d) ? d : d.toFixed(2)}`;
};

/** "$15/hr", "$15–20/hr", "$50", "Volunteer", "Pay not listed". Amounts are stored in cents. */
export function formatPay(job: { payType: PayType; payMin: number | null; payMax: number | null }) {
  if (job.payType === "VOLUNTEER") return "Volunteer";
  const { payMin: min, payMax: max } = job;
  if (min == null && max == null) return "Pay not listed";
  const suffix = job.payType === "HOURLY" ? "/hr" : "";
  if (min != null && max != null && min !== max) return `${dollars(min)}–${dollars(max).slice(1)}${suffix}`;
  return `${dollars((min ?? max)!)}${suffix}`;
}

/** "lawn-mowing" → "Lawn mowing" */
export function labelize(value: string) {
  const s = value.replace(/-/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function postedAgo(date: Date | null, now = new Date()) {
  if (!date) return null;
  const days = Math.floor((now.getTime() - date.getTime()) / 864e5);
  if (days <= 0) return "Posted today";
  if (days === 1) return "Posted yesterday";
  if (days < 30) return `Posted ${days} days ago`;
  return `Posted ${date.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}

/** Only allow same-site relative redirects (blocks "//evil.com" and absolute URLs). */
export function safeNext(next: unknown, fallback = "/jobs") {
  return typeof next === "string" && next.startsWith("/") && !next.startsWith("//") ? next : fallback;
}
