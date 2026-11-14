import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export const RECEIPT_BUCKET = "receipts";

/** Delete stored images for the given receipt_files rows (keeps the fingerprint row for duplicate detection). */
export async function deleteReceiptImages(supabase: SupabaseClient, rows: Array<{ id: string; storage_path: string }>) {
  if (!rows.length) return;
  await supabase.storage.from(RECEIPT_BUCKET).remove(rows.map((r) => r.storage_path));
  await supabase
    .from("receipt_files")
    .update({ deleted_at: new Date().toISOString() })
    .in(
      "id",
      rows.map((r) => r.id),
    );
}

export async function signedReceiptUrl(supabase: SupabaseClient, storagePath: string, seconds = 300) {
  const { data } = await supabase.storage.from(RECEIPT_BUCKET).createSignedUrl(storagePath, seconds);
  return data?.signedUrl ?? null;
}
