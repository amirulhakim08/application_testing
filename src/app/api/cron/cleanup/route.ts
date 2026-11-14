import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { RECEIPT_BUCKET } from "@/lib/receipt-storage";

export const runtime = "nodejs";
export const maxDuration = 300;

function authorized(req: Request) {
  const secret = process.env.CRON_SECRET;
  const header = req.headers.get("authorization") ?? "";
  if (!secret || secret === "change-me") return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const got = Buffer.from(header);
  return expected.length === got.length && timingSafeEqual(expected, got);
}

/**
 * Receipt retention job (run daily, e.g. Vercel Cron or Supabase scheduled function):
 * - deletes temporary images never attached to an expense after 24 hours
 * - deletes images older than 90 days for users who chose "90 days"
 * Fingerprint rows are kept so duplicate detection keeps working.
 */
async function run(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const admin = createAdminClient();
  const dayAgo = new Date(Date.now() - 24 * 3600_000).toISOString();
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 3600_000).toISOString();

  const { data: temp } = await admin
    .from("receipt_files")
    .select("id, storage_path")
    .is("attached_at", null)
    .is("deleted_at", null)
    .lt("created_at", dayAgo)
    .limit(1000);

  const { data: prefs } = await admin.from("user_preferences").select("user_id").eq("receipt_retention", "days_90");
  const ninetyUsers = (prefs ?? []).map((p) => p.user_id as string);
  let aged: Array<{ id: string; storage_path: string }> = [];
  if (ninetyUsers.length) {
    const { data } = await admin
      .from("receipt_files")
      .select("id, storage_path")
      .in("user_id", ninetyUsers)
      .is("deleted_at", null)
      .lt("created_at", ninetyDaysAgo)
      .limit(1000);
    aged = (data ?? []) as typeof aged;
  }

  // Unattached temporary uploads are removed entirely (row + object); aged ones keep the fingerprint row.
  const tempRows = (temp ?? []) as Array<{ id: string; storage_path: string }>;
  if (tempRows.length) {
    await admin.storage.from(RECEIPT_BUCKET).remove(tempRows.map((r) => r.storage_path));
    await admin.from("ai_extraction_results").delete().in("receipt_file_id", tempRows.map((r) => r.id));
    await admin.from("receipt_files").delete().in("id", tempRows.map((r) => r.id));
  }
  if (aged.length) {
    await admin.storage.from(RECEIPT_BUCKET).remove(aged.map((r) => r.storage_path));
    await admin.from("receipt_files").update({ deleted_at: new Date().toISOString() }).in("id", aged.map((r) => r.id));
  }
  return NextResponse.json({ temporaryDeleted: tempRows.length, agedDeleted: aged.length });
}

export const GET = run;
export const POST = run;
