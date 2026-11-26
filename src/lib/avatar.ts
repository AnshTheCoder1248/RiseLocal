export const MAX_AVATAR_BYTES = 1024 * 1024; // 1 MB — the picker resizes to 256px, so real uploads are far smaller
export const AVATAR_SIZE_PX = 256;
export const AVATAR_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

/** The URL an uploaded avatar is served from; the version busts the browser cache on change. */
export const avatarUrl = (updatedAt: Date) => `/api/avatar?v=${updatedAt.getTime()}`;

/** Checks the file's leading bytes really are the image type it claims to be. */
export function looksLikeImage(bytes: Uint8Array, type: string) {
  const at = (i: number, ...b: number[]) => b.every((v, j) => bytes[i + j] === v);
  if (type === "image/png") return at(0, 0x89, 0x50, 0x4e, 0x47);
  if (type === "image/jpeg") return at(0, 0xff, 0xd8, 0xff);
  if (type === "image/webp") return at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50);
  return false;
}
