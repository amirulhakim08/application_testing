"use client";

const ALLOWED = ["image/jpeg", "image/png", "image/webp"];
export const MAX_CLIENT_BYTES = 10 * 1024 * 1024;

export function validateImageFile(file: File): "unsupported" | "too_large" | null {
  if (!ALLOWED.includes(file.type)) return "unsupported";
  if (file.size > 25 * 1024 * 1024) return "too_large"; // compression can't rescue beyond this
  return null;
}

/**
 * Downscale large photos in the browser before upload (faster on mobile data)
 * while keeping enough resolution for small receipt text (long edge 2200px).
 */
export async function compressImage(file: File, maxEdge = 2200, quality = 0.88): Promise<File> {
  if (file.size < 1.5 * 1024 * 1024) return file;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, "image/jpeg", quality));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}
