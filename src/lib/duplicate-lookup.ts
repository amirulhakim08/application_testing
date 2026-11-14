import "server-only";
import { addDays, type ISODate } from "@/lib/dates";
import { centsToDecimalString, parseToCents, type Cents } from "@/lib/money";
import { findDuplicates, type DuplicateMatch, type ExistingExpense } from "@/lib/duplicates";
import type { AppContext } from "@/lib/data";

/** Look up likely duplicates of a proposed expense among the user's saved expenses. */
export async function lookupDuplicates(
  ctx: AppContext,
  probe: { amountCents: Cents | null; date: ISODate; merchant: string | null; imageSha256?: string | null; excludeId?: string },
): Promise<DuplicateMatch[]> {
  const existing: ExistingExpense[] = [];
  const cols = "id, amount::text, expense_date, merchant, description, receipt_files(sha256)";
  const toExisting = (r: Record<string, unknown>): ExistingExpense => {
    const rf = r.receipt_files as { sha256?: string } | Array<{ sha256?: string }> | null;
    const sha = Array.isArray(rf) ? rf[0]?.sha256 : rf?.sha256;
    return {
      id: r.id as string,
      amountCents: parseToCents(r.amount as string) ?? 0,
      date: r.expense_date as string,
      merchant: (r.merchant as string) ?? null,
      description: (r.description as string) ?? null,
      imageSha256: sha ?? null,
    };
  };

  if (probe.amountCents !== null) {
    const { data } = await ctx.supabase
      .from("expenses")
      .select(cols)
      .is("deleted_at", null)
      .eq("amount", centsToDecimalString(probe.amountCents))
      .gte("expense_date", addDays(probe.date, -1))
      .lte("expense_date", addDays(probe.date, 1))
      .limit(20);
    existing.push(...(data ?? []).map((r) => toExisting(r as Record<string, unknown>)));
  }
  if (probe.imageSha256) {
    const { data: files } = await ctx.supabase.from("receipt_files").select("id").eq("sha256", probe.imageSha256).limit(20);
    const ids = (files ?? []).map((f) => f.id);
    if (ids.length) {
      const { data } = await ctx.supabase.from("expenses").select(cols).is("deleted_at", null).in("receipt_file_id", ids).limit(20);
      for (const r of data ?? []) {
        const e = toExisting(r as Record<string, unknown>);
        if (!existing.some((x) => x.id === e.id)) existing.push({ ...e, imageSha256: probe.imageSha256 });
      }
    }
  }
  return findDuplicates(
    { amountCents: probe.amountCents ?? -1, date: probe.date, merchant: probe.merchant, imageSha256: probe.imageSha256, excludeId: probe.excludeId },
    existing,
  );
}
