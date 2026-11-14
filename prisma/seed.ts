// Seed realistic sample data for every role (NFR-OPS). Run: npm run db:seed
// All seed accounts share SEED_PASSWORD below — local development only.
import "dotenv/config";
import { createPrismaClient } from "../src/lib/db";
import { hashPassword } from "../src/lib/auth/password";
import { generateCertCode, signCertificate } from "../src/lib/certs/sign";

const SEED_PASSWORD = "riselocal-dev-123";

// Seed over the direct connection, like migrations.
const db = createPrismaClient(process.env.DIRECT_URL ?? process.env.DATABASE_URL);

const yearsAgo = (y: number, extraDays = 0) => new Date(Date.now() - (y * 365.25 + extraDays) * 864e5);
const daysAgo = (d: number) => new Date(Date.now() - d * 864e5);

async function main() {
  const passwordHash = await hashPassword(SEED_PASSWORD);

  // Wipe in dependency order (dev only).
  await db.$transaction([
    db.emailOutbox.deleteMany(), db.rateLimitBucket.deleteMany(), db.cronRun.deleteMany(), db.cronLock.deleteMany(),
    db.auditLog.deleteMany(), db.notification.deleteMany(), db.certificate.deleteMany(), db.report.deleteMany(),
    db.savedJob.deleteMany(), db.application.deleteMany(), db.agentDraft.deleteMany(), db.agentRun.deleteMany(),
    db.agentSource.deleteMany(), db.watch.deleteMany(), db.job.deleteMany(), db.location.deleteMany(),
    db.guardian.deleteMany(), db.studentProfile.deleteMany(), db.account.deleteMany(), db.session.deleteMany(),
    db.user.deleteMany(), db.employerOrg.deleteMany(),
  ]);

  const admin = await db.user.create({
    data: { role: "ADMIN", email: "priya@riselocal.local", passwordHash, displayName: "Priya Admin", dateOfBirth: yearsAgo(32), status: "ACTIVE" },
  });

  const riverside = await db.employerOrg.create({
    data: {
      name: "Riverside Pet Care", address: "100 River Rd (private)", verified: true, verificationStatus: "VERIFIED",
      locations: { create: { name: "Maple Grove", areaLabel: "Maple Grove · 55311", lat: 45.07, lng: -93.46 } },
    },
    include: { locations: true },
  });
  const greenMarket = await db.employerOrg.create({
    data: {
      name: "Green Market", verified: true, verificationStatus: "VERIFIED",
      locations: { create: { name: "Maple Grove", areaLabel: "Maple Grove · 55311", lat: 45.08, lng: -93.45 } },
    },
    include: { locations: true },
  });
  const beanScene = await db.employerOrg.create({ data: { name: "Bean Scene Café", address: "12 Main St (private)", verificationStatus: "PENDING" } });

  const rosa = await db.user.create({
    data: { role: "EMPLOYER", email: "rosa@riselocal.local", passwordHash, displayName: "Rosa Martinez", dateOfBirth: yearsAgo(41), status: "ACTIVE", orgId: greenMarket.id },
  });
  const riversideMgr = await db.user.create({
    data: { role: "EMPLOYER", email: "sam@riselocal.local", passwordHash, displayName: "Sam Lee", dateOfBirth: yearsAgo(36), status: "ACTIVE", orgId: riverside.id },
  });
  await db.user.create({
    data: { role: "EMPLOYER", email: "bean@riselocal.local", passwordHash, displayName: "Jo Park", dateOfBirth: yearsAgo(29), status: "ACTIVE", orgId: beanScene.id },
  });
  const dev = await db.user.create({
    data: { role: "COMMUNITY", email: "dev@riselocal.local", passwordHash, displayName: "Dev Nair", dateOfBirth: yearsAgo(45), status: "ACTIVE" },
  });
  const alex = await db.user.create({
    data: { role: "COMMUNITY", email: "alex@riselocal.local", passwordHash, displayName: "Alex Petrov", dateOfBirth: yearsAgo(52), status: "ACTIVE" },
  });

  const maya = await db.user.create({
    data: {
      role: "STUDENT", email: "maya@riselocal.local", passwordHash, displayName: "Maya Rodriguez", dateOfBirth: yearsAgo(15, 40), isMinor: true, status: "ACTIVE",
      guardian: { create: { email: "maya.guardian@riselocal.local", consentAt: daysAgo(30), requireApproval: true } },
      studentProfile: { create: { firstName: "Maya", areaLabel: "Maple Grove · 55311", lat: 45.07, lng: -93.46, availability: ["after-school", "weekends"], skills: ["animal care", "reliability"] } },
    },
  });
  const jordan = await db.user.create({
    data: {
      role: "STUDENT", email: "jordan@riselocal.local", passwordHash, displayName: "Jordan Kim", dateOfBirth: yearsAgo(17, 10), isMinor: true, status: "ACTIVE",
      studentProfile: { create: { firstName: "Jordan", areaLabel: "Maple Grove · 55311", lat: 45.06, lng: -93.44, availability: ["weekends"], skills: ["math", "customer service"] } },
    },
  });
  await db.user.create({
    data: {
      role: "STUDENT", email: "leo@riselocal.local", passwordHash, displayName: "Leo Chen", dateOfBirth: yearsAgo(14, 20), isMinor: true, status: "PENDING",
      guardian: { create: { email: "leo.guardian@riselocal.local" } },
      studentProfile: { create: { firstName: "Leo", availability: [], skills: [] } },
    },
  });

  const job = (data: Parameters<typeof db.job.create>[0]["data"]) => db.job.create({ data });

  const dogWalker = await job({
    source: "EMPLOYER", status: "PUBLISHED", title: "After-school dog walker", category: "pet-care", tags: ["dogs", "outdoors"],
    description: "Walk two friendly dogs after school on weekdays. 45-minute loop near Maple Grove Park. Leashes and treats provided. Great for someone reliable who loves animals.",
    payType: "HOURLY", payMin: 1800, payMax: 1800, minAge: 14, schedule: "after-school", areaLabel: "Maple Grove · 55311", lat: 45.07, lng: -93.46,
    postedById: riversideMgr.id, orgId: riverside.id, locationId: riverside.locations[0].id, suitability: 0.95, publishedAt: daysAgo(3), positions: 2,
  });
  await job({
    source: "COMMUNITY", status: "PUBLISHED", title: "Math tutor — 6th grade", category: "tutoring", tags: ["math", "remote"],
    description: "Looking for a patient high schooler to help my 6th grader with fractions and pre-algebra twice a week. Remote is fine.",
    payType: "HOURLY", payMin: 2200, payMax: 2200, minAge: 15, schedule: "recurring", remote: true, areaLabel: "Maple Grove · 55311", lat: 45.07, lng: -93.45,
    postedById: dev.id, suitability: 0.97, publishedAt: daysAgo(1),
  });
  const bagger = await job({
    source: "EMPLOYER", status: "PUBLISHED", title: "Weekend bagger", category: "retail", tags: ["grocery"],
    description: "Bag groceries and help customers to their cars on Saturdays and Sundays. Friendly team, flexible shifts.",
    payType: "HOURLY", payMin: 1500, payMax: 1500, minAge: 16, schedule: "weekends", areaLabel: "Maple Grove · 55311", lat: 45.08, lng: -93.45,
    postedById: rosa.id, orgId: greenMarket.id, locationId: greenMarket.locations[0].id, suitability: 0.93, publishedAt: daysAgo(7),
  });
  await job({
    source: "COMMUNITY", status: "PUBLISHED", title: "Snow removal crew", category: "snow-removal", tags: ["winter", "on-call"],
    description: "Clear my driveway and front walk after each snowfall. Shovel provided; snowblower optional. Usually 45–60 minutes.",
    payType: "FIXED", payMin: 2500, payMax: 2500, minAge: 16, schedule: "seasonal", areaLabel: "Maple Grove · 55311", lat: 45.06, lng: -93.47,
    postedById: alex.id, suitability: 0.9, publishedAt: daysAgo(2),
  });
  await job({
    source: "EMPLOYER", status: "DRAFT", title: "Holiday gift wrapper", category: "retail", tags: ["seasonal"],
    description: "Wrap gifts at our holiday table on weekends in December.", payType: "HOURLY", payMin: 1600, payMax: 1600, minAge: 15,
    schedule: "seasonal", areaLabel: "Maple Grove · 55311", postedById: rosa.id, orgId: greenMarket.id,
  });
  const parkCleanup = await job({
    source: "COMMUNITY", status: "FILLED", title: "Park cleanup volunteer", category: "other", tags: ["volunteer", "outdoors"],
    description: "Help pick up litter and plant flowers at Maple Grove Park on Saturday mornings.", payType: "VOLUNTEER", minAge: 13,
    schedule: "weekends", areaLabel: "Maple Grove · 55311", postedById: dev.id, publishedAt: daysAgo(60),
  });
  // Held for moderation (PII in description) — never visible to students.
  await job({
    source: "COMMUNITY", status: "DRAFT", moderationHold: true, safetyFlags: ["off_platform_contact", "cash_only"], suitability: 0.35,
    title: "Cash job, text me", category: "errands", description: "Quick errands, cash only. Text me for details.",
    payType: "FIXED", payMin: 2000, areaLabel: "Maple Grove · 55311", postedById: alex.id,
  });

  // Applications: Maya hired + completed on dog walking (→ certificate), Jordan applied to bagger.
  await db.application.create({
    data: {
      jobId: dogWalker.id, studentId: maya.id, status: "HIRED", note: "I have a dog at home and walk him every day!", guardianApprovedAt: daysAgo(150),
      studentConfirmedAt: daysAgo(5), posterConfirmedAt: daysAgo(5), hoursLogged: 48, posterRating: 5, studentRating: 5, createdAt: daysAgo(160),
    },
  });
  await db.application.create({
    data: { jobId: parkCleanup.id, studentId: maya.id, status: "HIRED", studentConfirmedAt: daysAgo(20), posterConfirmedAt: daysAgo(20), hoursLogged: 8, posterRating: 5, studentRating: 5 },
  });
  await db.application.create({ data: { jobId: bagger.id, studentId: jordan.id, status: "SENT", note: "Available every weekend." } });

  const certBase = {
    code: generateCertCode(), kind: "work", jobId: dogWalker.id, studentId: maya.id, issuerId: riversideMgr.id,
    roleTitle: "After-school Dog Walker", startDate: daysAgo(160), endDate: daysAgo(5), totalHours: 48,
  };
  await db.certificate.create({
    data: { ...certBase, category: "pet-care", skills: ["Reliability", "Animal care", "Time management"], rating: 5, note: "Maya never missed a walk.", signature: signCertificate(certBase) },
  });

  await db.watch.createMany({
    data: [
      { studentId: maya.id, name: "Dog walking < 2 mi, $15+", filters: { category: ["pet-care"], payMin: 1500, lat: 45.07, lng: -93.46, radiusMi: 2 }, channels: ["in_app", "email"], frequency: "instant" },
      { studentId: maya.id, name: "Café / retail near school", filters: { category: ["retail", "food-service"], schedule: ["after-school"] }, channels: ["in_app"], frequency: "daily" },
      { studentId: jordan.id, name: "Tutoring", filters: { category: ["tutoring"] }, channels: ["in_app"], frequency: "instant", active: true },
    ],
  });

  await db.notification.create({
    data: { userId: maya.id, kind: "watch_match", payload: { watchName: "Dog walking < 2 mi, $15+", jobId: dogWalker.id, title: dogWalker.title, pay: "$18/hr", area: dogWalker.areaLabel } },
  });

  // Scout: a source, a run, and a pending draft in Green Market's Suggested tab.
  const source = await db.agentSource.create({
    data: { name: "Green Market careers", type: "html", url: "https://example.com/careers", frequency: "every 6h", hints: { orgId: greenMarket.id }, enabled: true,
      // Seeded as already crawled, so the dev cron doesn't hit the placeholder URL right away.
      crawlStatus: "COMPLETED", lastRunAt: new Date(), nextRunAt: new Date(Date.now() + 6 * 36e5) },
  });
  const run = await db.agentRun.create({
    data: { sourceId: source.id, status: "succeeded", finishedAt: daysAgo(0), found: 3, drafted: 2, rejected: 1, model: "seed", promptVer: "extract-v1", costUsd: 0.04, rejections: [{ url: "https://example.com/careers#barback", reason: "alcohol" }] },
  });
  await db.agentDraft.create({
    data: {
      run: { connect: { id: run.id } }, orgId: greenMarket.id, sourceUrl: "https://example.com/careers#stock", confidence: 0.92, fingerprint: "seed-stock-clerk",
      rawPayload: { title: "Weekend stock clerk", employer: "Green Market", confidence: { title: 0.98, pay: 0.9 } },
      job: {
        create: {
          source: "AGENT", status: "DRAFT", title: "Weekend stock clerk", category: "retail", description: "Restock shelves and help keep aisles tidy on weekends.",
          payType: "HOURLY", payMin: 1500, payMax: 1500, minAge: 16, schedule: "weekends", areaLabel: "Maple Grove · 55311",
          postedById: rosa.id, orgId: greenMarket.id, suitability: 0.92,
        },
      },
    },
  });

  await db.report.create({ data: { reporterId: jordan.id, targetType: "user", targetId: alex.id, reason: "pii_solicitation", details: "Asked me to text them." } });

  console.info(`Seeded. Sign in with any *@riselocal.local account (password in prisma/seed.ts). Admin: ${admin.email}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
