import { db } from "@/lib/db";
import { badRequest, handler, json, notFound } from "@/lib/api";
import { requireUser } from "@/lib/auth/session";
import { AVATAR_TYPES, avatarUrl, looksLikeImage, MAX_AVATAR_BYTES } from "@/lib/avatar";

// GET/POST/DELETE /api/avatar — the signed-in user's own uploaded profile photo.
// Only ever served to its owner: many users are minors, so photos aren't shown to others.

export const GET = handler(async () => {
  const user = await requireUser({ allowPending: true });
  const avatar = await db.avatar.findUnique({ where: { userId: user.id } });
  if (!avatar) throw notFound("No avatar uploaded");
  return new Response(new Uint8Array(avatar.data), {
    headers: {
      "Content-Type": avatar.contentType,
      "Content-Length": String(avatar.size),
      // URLs are versioned (?v=updatedAt), so a cached copy is never stale.
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
});

export const POST = handler(async (req: Request) => {
  const user = await requireUser({ allowPending: true });
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw badRequest("Send the photo as multipart form data");
  }
  const file = form.get("file");
  if (!(file instanceof File)) throw badRequest("Choose a photo to upload");
  if (!(AVATAR_TYPES as readonly string[]).includes(file.type)) throw badRequest("Upload a PNG, JPEG or WebP image.");
  if (file.size === 0 || file.size > MAX_AVATAR_BYTES) throw badRequest("Photos can be up to 1 MB.");
  const data = new Uint8Array(await file.arrayBuffer());
  if (!looksLikeImage(data, file.type)) throw badRequest("That file isn’t a valid image.");

  const avatar = await db.avatar.upsert({
    where: { userId: user.id },
    create: { userId: user.id, contentType: file.type, size: file.size, data },
    update: { contentType: file.type, size: file.size, data },
    select: { updatedAt: true },
  });
  return json({ image: avatarUrl(avatar.updatedAt) }, 201);
});

export const DELETE = handler(async () => {
  const user = await requireUser({ allowPending: true });
  await db.avatar.deleteMany({ where: { userId: user.id } });
  return json({ ok: true });
});
