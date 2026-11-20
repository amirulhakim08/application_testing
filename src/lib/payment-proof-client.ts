"use client";

import { createClient } from "@/lib/supabase/client";
import { compressImage } from "@/lib/client-image";
import { attachPaymentProof } from "@/app/actions/sales";

export const PROOF_BUCKET = "payment-proofs";
export const PROOF_MAX_BYTES = 5 * 1024 * 1024;
const TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

/** Images are shrunk first, so phone screenshots above 5 MB still fit. */
export async function prepareProof(file: File): Promise<{ ok: true; file: File } | { ok: false; reason: "type" | "size" }> {
  if (!TYPES.includes(file.type)) return { ok: false, reason: "type" };
  const ready = file.type === "application/pdf" ? file : await compressImage(file, 2000, 0.85);
  if (ready.size > PROOF_MAX_BYTES) return { ok: false, reason: "size" };
  return { ok: true, file: ready };
}

/** Uploads the proof into the payment's private folder and links it. Returns false if it could not be saved. */
export async function uploadPaymentProof(organizationId: string, paymentId: string, file: File): Promise<boolean> {
  const ext = file.type === "application/pdf" ? "pdf" : file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `${organizationId}/${paymentId}/bukti-bayaran.${ext}`;
  const supabase = createClient();
  const { error } = await supabase.storage.from(PROOF_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
  if (error && !/exists|duplicate/i.test(error.message)) return false;
  const r = await attachPaymentProof(paymentId, path);
  return r.ok;
}
