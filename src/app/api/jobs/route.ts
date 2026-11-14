import { db } from "@/lib/db";
import { handler, json, parseBody, parseQuery, forbidden } from "@/lib/api";
import { boardQuerySchema, createJobSchema } from "@/lib/validation/jobs";
import { getCurrentUser, requireUser } from "@/lib/auth/session";
import { searchBoard, withEligibility } from "@/lib/jobs/search";
import { publishJob } from "@/lib/jobs/service";
import { checkContent } from "@/lib/safety/filter";
import { ageOn } from "@/lib/auth/age";
import { coarsen } from "@/lib/geo";
import { enforceRateLimit, LIMITS } from "@/lib/rate-limit";

// GET /api/jobs — board query; only published jobs that passed the safety gate.
export const GET = handler(async (req: Request) => {
  const query = parseQuery(req, boardQuerySchema);
  const viewer = await getCurrentUser();
  const age = viewer?.role === "STUDENT" && viewer.dateOfBirth ? ageOn(viewer.dateOfBirth) : undefined;
  const result = await searchBoard(query, { age });
  return json({ ...result, items: withEligibility(result.items, age) });
});

// POST /api/jobs — employer or community creates a job/gig (DRAFT), with a suitability preview.
export const POST = handler(async (req: Request) => {
  const user = await requireUser({ roles: ["EMPLOYER", "COMMUNITY", "ADMIN"] });
  if (user.role !== "ADMIN") await enforceRateLimit(LIMITS.jobPost(user.id));
  const { publish, startDate, expiresAt, lat, lng, locationId, ...input } = await parseBody(req, createJobSchema);

  if (locationId) {
    const loc = await db.location.findUnique({ where: { id: locationId } });
    if (!loc || (loc.orgId !== user.orgId && user.role !== "ADMIN")) throw forbidden("Unknown location");
  }

  const preview = checkContent(input);
  let job = await db.job.create({
    data: {
      ...input,
      source: user.role === "COMMUNITY" ? "COMMUNITY" : "EMPLOYER",
      status: "DRAFT",
      startDate: startDate ? new Date(startDate) : null,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
      lat: coarsen(lat),
      lng: coarsen(lng),
      locationId,
      postedById: user.id,
      orgId: user.role === "EMPLOYER" ? user.orgId : null,
      suitability: preview.score,
      safetyFlags: preview.flags,
    },
  });

  let publishResult: { held: boolean; message: string } | undefined;
  if (publish) {
    const r = await publishJob(job, user);
    job = r.job;
    publishResult = { held: r.held, message: r.message };
  }

  return json({ job, suitabilityPreview: preview, publish: publishResult }, 201);
});
