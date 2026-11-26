"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { AVATAR_SIZE_PX } from "@/lib/avatar";
import { initials } from "@/lib/user-display";

/** Center-crops the image to a square and scales it down, so uploads stay small. */
async function toSquare(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const out = Math.min(AVATAR_SIZE_PX, side);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = out;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, out, out);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.9));
  // Browsers without WebP encoding (older Safari) return PNG instead; use JPEG there.
  return blob?.type === "image/webp" ? blob : new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode"))), "image/jpeg", 0.9));
}

export function AvatarPicker({ name, image, hasCustom }: { name: string; image: string | null; hasCustom: boolean }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"upload" | "remove" | null>(null);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) return toast.error("Choose an image file.");
    setBusy("upload");
    try {
      let blob: Blob;
      try {
        blob = await toSquare(file);
      } catch {
        return toast.error("Couldn’t read that image. Try a PNG or JPEG.");
      }
      const body = new FormData();
      body.set("file", new File([blob], `avatar.${blob.type === "image/webp" ? "webp" : "jpg"}`, { type: blob.type }));
      const res = await fetch("/api/avatar", { method: "POST", body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return toast.error(data.error ?? "Upload failed. Please try again.");
      toast.success("Profile photo updated");
      router.refresh();
    } catch {
      toast.error("Couldn’t reach RiseLocal. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    setBusy("remove");
    try {
      const res = await fetch("/api/avatar", { method: "DELETE" });
      if (!res.ok) return toast.error("Couldn’t remove your photo. Please try again.");
      toast.success("Profile photo removed");
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy !== null}
        aria-label="Change profile photo"
        className="group relative rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60"
      >
        <Avatar className="size-20">
          {/* Google photo URLs reject requests that send a referrer. */}
          {image && <AvatarImage src={image} alt="" referrerPolicy="no-referrer" />}
          <AvatarFallback className="text-xl">{initials(name)}</AvatarFallback>
        </Avatar>
        <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/45 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          <Camera className="size-5" aria-hidden />
        </span>
      </button>
      <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp,image/*" className="hidden" onChange={onPick} />
      <div className="flex gap-1">
        <Button variant="outline" size="xs" onClick={() => inputRef.current?.click()} disabled={busy !== null}>
          {busy === "upload" ? "Uploading…" : hasCustom ? "Change" : "Add photo"}
        </Button>
        {hasCustom && (
          <Button variant="ghost" size="xs" onClick={remove} disabled={busy !== null}>
            {busy === "remove" ? "Removing…" : "Remove"}
          </Button>
        )}
      </div>
    </div>
  );
}
