import { getContext } from "@/lib/data";
import { todayKL } from "@/lib/dates";

/** Full personal data export (JSON). Receipt images are referenced by id; download them from the app. */
export async function GET() {
  const ctx = await getContext();
  const s = ctx.supabase;
  const [profile, organizations, categories, expenses, items, receipts, prefs, audit] = await Promise.all([
    s.from("profiles").select("*").maybeSingle(),
    s.from("organizations").select("*"),
    s.from("expense_categories").select("*"),
    s.from("expenses").select("*, amount::text, tax_amount::text, discount_amount::text").limit(50000),
    s.from("expense_items").select("*, amount::text").limit(100000),
    s.from("receipt_files").select("id, mime_type, size_bytes, sha256, attached_at, deleted_at, created_at"),
    s.from("user_preferences").select("*").maybeSingle(),
    s.from("audit_logs").select("*").order("created_at", { ascending: false }).limit(5000),
  ]);
  const body = JSON.stringify(
    {
      exported_at: new Date().toISOString(),
      account: { id: ctx.user.id, email: ctx.user.email },
      profile: profile.data,
      preferences: prefs.data,
      organizations: organizations.data,
      categories: categories.data,
      expenses: expenses.data,
      expense_items: items.data,
      receipt_files: receipts.data,
      audit_logs: audit.data,
    },
    null,
    2,
  );
  return new Response(body, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="bukutigalima-data-${todayKL()}.json"`,
      "Cache-Control": "private, no-store",
    },
  });
}
