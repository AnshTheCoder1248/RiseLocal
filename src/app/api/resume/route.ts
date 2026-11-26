import { db } from "@/lib/db";
import { badRequest, handler, json, notFound } from "@/lib/api";
import { requireUser } from "@/lib/auth/session";
import { resumeFileError } from "@/lib/resume";

// GET/POST/DELETE /api/resume — the signed-in student's own resume file.

export const GET = handler(async () => {
  const user = await requireUser({ roles: ["STUDENT"], allowPending: true });
  const resume = await db.resume.findUnique({ where: { userId: user.id } });
  if (!resume) throw notFound("No resume uploaded");
  return new Response(new Uint8Array(resume.data), {
    headers: {
      "Content-Type": resume.contentType,
      "Content-Length": String(resume.size),
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(resume.fileName)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});

export const POST = handler(async (req: Request) => {
  const user = await requireUser({ roles: ["STUDENT"], allowPending: true });
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw badRequest("Send the resume as multipart form data");
  }
  const file = form.get("file");
  if (!(file instanceof File)) throw badRequest("Choose a file to upload");
  const error = resumeFileError(file);
  if (error) throw badRequest(error);

  const fileName = file.name.replace(/[\\/\r\n"]/g, "_").slice(0, 200);
  const data = { fileName, contentType: file.type, size: file.size, data: new Uint8Array(await file.arrayBuffer()) };
  const resume = await db.resume.upsert({
    where: { userId: user.id },
    create: { userId: user.id, ...data },
    update: { ...data, uploadedAt: new Date() },
    select: { fileName: true, size: true, uploadedAt: true },
  });
  return json({ resume }, 201);
});

export const DELETE = handler(async () => {
  const user = await requireUser({ roles: ["STUDENT"], allowPending: true });
  await db.resume.deleteMany({ where: { userId: user.id } });
  return json({ ok: true });
});
