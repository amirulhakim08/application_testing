import { NextResponse } from "next/server";
import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import { requireUser, jsonError } from "@/lib/api-auth";
import { MAX_UPLOAD_BYTES, sniffImageType } from "@/lib/validation";
import { getVisionProvider } from "@/lib/ai";
import { assertWithinRateLimit, errorCodeOf, recordUsage } from "@/lib/ai/guard";
import { AIError } from "@/lib/ai/types";
import { RECEIPT_BUCKET } from "@/lib/receipt-storage";
import { sanitizeReceipt, type SanitizedReceipt } from "@/lib/receipt-sanitize";
import { todayKL } from "@/lib/dates";
import { findDuplicates, type DuplicateMatch, type ExistingExpense } from "@/lib/duplicates";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseToCents } from "@/lib/money";

export const runtime = "nodejs";
export const maxDuration = 90;

/**
 * Receipt pipeline: validate -> normalise image -> fingerprint -> store privately
 * -> (cached or fresh) AI extraction -> deterministic validation -> duplicate check.
 * Nothing here creates an expense; the user reviews and confirms on the client.
 */
export async function POST(req: Request) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const { supabase, user } = auth;

  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_UPLOAD_BYTES + 64 * 1024) return jsonError("too_large", 413);

  let file: File | null = null;
  let attachOnly = false;
  try {
    const form = await req.formData();
    const f = form.get("image");
    file = f instanceof File ? f : null;
    attachOnly = form.get("mode") === "attach"; // manual entry: store only, no AI cost
  } catch {
    return jsonError("bad_request", 400);
  }
  if (!file) return jsonError("bad_request", 400, "No image provided");
  if (file.size > MAX_UPLOAD_BYTES) return jsonError("too_large", 413);

  const original = Buffer.from(await file.arrayBuffer());
  const sniffed = sniffImageType(original);
  if (!sniffed) return jsonError("unsupported_media", 415, "Use a JPEG, PNG or WebP image");

  const sha256 = createHash("sha256").update(original).digest("hex");

  // Normalise: honour EXIF orientation, strip metadata (e.g. GPS), cap size, keep text legible.
  let processed: Buffer;
  try {
    processed = await sharp(original, { limitInputPixels: 60_000_000 })
      .rotate()
      .resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
  } catch {
    return jsonError("unsupported_media", 415, "The image could not be read");
  }

  // Reuse an existing stored file + extraction for the identical image (avoids duplicate paid processing).
  const [{ data: priorFile }, { data: priorExtraction }] = await Promise.all([
    supabase.from("receipt_files").select("id").eq("sha256", sha256).is("deleted_at", null).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("ai_extraction_results").select("id, result").eq("image_sha256", sha256).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);

  let receiptFileId = priorFile?.id as string | undefined;
  if (!receiptFileId) {
    const path = `${user.id}/${randomUUID()}.webp`;
    const up = await supabase.storage.from(RECEIPT_BUCKET).upload(path, processed, { contentType: "image/webp", upsert: false });
    if (up.error) return jsonError("storage_error", 500, "Could not store the receipt image");
    const { data: rf, error } = await supabase
      .from("receipt_files")
      .insert({ user_id: user.id, storage_path: path, mime_type: "image/webp", size_bytes: processed.length, sha256 })
      .select("id")
      .single();
    if (error || !rf) {
      await supabase.storage.from(RECEIPT_BUCKET).remove([path]);
      return jsonError("storage_error", 500, "Could not store the receipt image");
    }
    receiptFileId = rf.id as string;
  }

  // Duplicate check by image fingerprint (regardless of AI availability)
  const duplicatesByImage = await imageDuplicates(supabase, sha256);

  const provider = attachOnly ? null : getVisionProvider();
  if (!provider) {
    return NextResponse.json({ receiptFileId, extractionId: null, extraction: null, aiUnavailable: !attachOnly, cached: false, duplicates: duplicatesByImage });
  }

  const today = todayKL();
  const { data: cats } = await supabase.from("expense_categories").select("name").is("archived_at", null);
  const allowed = [...new Set((cats ?? []).map((c) => c.name as string))];

  let extraction: SanitizedReceipt;
  let extractionId: string | null = null;
  let cached = false;

  if (priorExtraction?.result) {
    extraction = priorExtraction.result as SanitizedReceipt;
    extractionId = priorExtraction.id as string;
    cached = true;
    await recordUsage(supabase, { userId: user.id, kind: "receipt_scan", provider: provider.name, success: true, cached: true });
  } else {
    const started = Date.now();
    try {
      await assertWithinRateLimit(supabase, user.id, "receipt_scan");
      const raw = await provider.extractReceipt({ image: processed, mimeType: "image/webp", today, categories: allowed });
      extraction = sanitizeReceipt(raw, today, allowed);
      await recordUsage(supabase, { userId: user.id, kind: "receipt_scan", provider: provider.name, success: true, durationMs: Date.now() - started });
    } catch (err) {
      const code = errorCodeOf(err);
      if (!(err instanceof AIError && err.code === "rate_limited")) {
        await recordUsage(supabase, { userId: user.id, kind: "receipt_scan", provider: provider.name, success: false, errorCode: code, durationMs: Date.now() - started });
      }
      // The image is stored; the user can still complete the expense manually.
      return NextResponse.json(
        { receiptFileId, extractionId: null, extraction: null, aiError: code, cached: false, duplicates: duplicatesByImage },
        { status: 200 },
      );
    }
    const { data: saved } = await supabase
      .from("ai_extraction_results")
      .insert({
        user_id: user.id,
        source: "receipt_scan",
        receipt_file_id: receiptFileId,
        image_sha256: sha256,
        provider: provider.name,
        model: provider.model,
        result: extraction,
        overall_confidence: extraction.overallConfidence,
        needs_review: extraction.needsReview,
      })
      .select("id")
      .single();
    extractionId = (saved?.id as string) ?? null;
  }

  // Duplicate check on the extracted facts
  let duplicates = duplicatesByImage;
  if (extraction.total.amountCents !== null && extraction.date.value) {
    const { data } = await supabase
      .from("expenses")
      .select("id, amount::text, expense_date, merchant, description")
      .is("deleted_at", null)
      .eq("amount", (extraction.total.amountCents / 100).toFixed(2))
      .gte("expense_date", extraction.date.value)
      .lte("expense_date", extraction.date.value)
      .limit(10);
    const existing: ExistingExpense[] = (data ?? []).map((r) => ({
      id: r.id,
      amountCents: parseToCents(r.amount as unknown as string) ?? 0,
      date: r.expense_date,
      merchant: r.merchant,
      description: r.description,
      imageSha256: null,
    }));
    const factual = findDuplicates({ amountCents: extraction.total.amountCents, date: extraction.date.value, merchant: extraction.merchant.value }, existing).filter(
      (m) => m.level === "likely",
    );
    duplicates = [...duplicates, ...factual.filter((m) => !duplicates.some((d) => d.expense.id === m.expense.id))];
  }

  return NextResponse.json({ receiptFileId, extractionId, extraction, cached, duplicates });
}

async function imageDuplicates(supabase: SupabaseClient, sha256: string): Promise<DuplicateMatch[]> {
  const { data: files } = await supabase.from("receipt_files").select("id").eq("sha256", sha256);
  const ids = (files ?? []).map((f) => f.id as string);
  if (!ids.length) return [];
  const { data } = await supabase
    .from("expenses")
    .select("id, amount::text, expense_date, merchant, description")
    .is("deleted_at", null)
    .in("receipt_file_id", ids)
    .limit(5);
  return (data ?? []).map((r) => ({
    level: "exact_image" as const,
    expense: { id: r.id, amountCents: parseToCents(r.amount as unknown as string) ?? 0, date: r.expense_date, merchant: r.merchant, description: r.description, imageSha256: sha256 },
  }));
}
