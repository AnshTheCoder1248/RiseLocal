import { db } from "@/lib/db";
import { handler, json, parseQuery, forbidden } from "@/lib/api";
import { listApplicationsSchema } from "@/lib/validation/applications";
import { requireUser } from "@/lib/auth/session";
import { ageBand, ageOn } from "@/lib/auth/age";
import type { Prisma } from "@/generated/prisma/client";

// GET /api/applications — a student's own applications, or an owner's applicant pipeline.
export const GET = handler(async (req: Request) => {
  const user = await requireUser();
  const { jobId } = parseQuery(req, listApplicationsSchema);

  if (user.role === "STUDENT") {
    const items = await db.application.findMany({
      where: { studentId: user.id, ...(jobId && { jobId }) },
      orderBy: { createdAt: "desc" },
      include: { job: { select: { id: true, title: true, areaLabel: true, status: true, payType: true, payMin: true, payMax: true, org: { select: { name: true, verified: true } } } } },
    });
    return json({ items });
  }

  // Posters see applicants for jobs they manage; admins see any job's pipeline.
  const where: Prisma.ApplicationWhereInput = { status: { not: "PENDING_GUARDIAN" }, ...(jobId && { jobId }) };
  if (user.role !== "ADMIN") {
    where.job = { OR: [{ postedById: user.id }, ...(user.role === "EMPLOYER" && user.orgId ? [{ orgId: user.orgId }] : [])] };
  } else if (!jobId) {
    throw forbidden("Admins must pass jobId");
  }

  const apps = await db.application.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      job: { select: { id: true, title: true } },
      student: { select: { id: true, dateOfBirth: true, isMinor: true, studentProfile: { select: { firstName: true, areaLabel: true, availability: true, skills: true } } } },
    },
  });

  // Privacy (SAFE-1, AP-1): posters see first name, age band and area — never contact info or exact age.
  const items = apps.map(({ student, ...a }) => ({
    ...a,
    student: {
      id: student.id,
      firstName: student.studentProfile?.firstName ?? "Student",
      ageBand: student.dateOfBirth ? ageBand(ageOn(student.dateOfBirth)) : null,
      areaLabel: student.studentProfile?.areaLabel ?? null,
      availability: student.studentProfile?.availability ?? [],
      skills: student.studentProfile?.skills ?? [],
    },
  }));

  // SAFE-7 / MOD-6: log who viewed a minor's application.
  const minorApps = apps.filter((a) => a.student.isMinor);
  if (minorApps.length) {
    await db.auditLog.createMany({
      data: minorApps.map((a) => ({ actorId: user.id, action: "application.view", targetType: "application", targetId: a.id })),
    });
  }
  // The poster's first look moves SENT → VIEWED (AP-3).
  if (user.role !== "ADMIN") {
    const unseen = apps.filter((a) => a.status === "SENT").map((a) => a.id);
    if (unseen.length) await db.application.updateMany({ where: { id: { in: unseen } }, data: { status: "VIEWED" } });
  }
  return json({ items });
});
