import { NextResponse } from "next/server";
import { requireUser, jsonError } from "@/lib/api-auth";
import { signedReceiptUrl } from "@/lib/receipt-storage";
import { uuid } from "@/lib/validation";

/** Returns a short-lived signed URL for the caller's own receipt image. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const { id } = await params;
  if (!uuid.safeParse(id).success) return jsonError("bad_request", 400);
  const { data } = await auth.supabase.from("receipt_files").select("storage_path, deleted_at").eq("id", id).maybeSingle();
  if (!data || data.deleted_at) return jsonError("not_found", 404);
  const url = await signedReceiptUrl(auth.supabase, data.storage_path as string, 300);
  if (!url) return jsonError("not_found", 404);
  return NextResponse.json({ url }, { headers: { "Cache-Control": "private, no-store" } });
}
