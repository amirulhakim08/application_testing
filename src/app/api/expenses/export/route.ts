import { getContext, listExpenses } from "@/lib/data";
import { filtersFromParams } from "@/lib/expense-filters";
import { toCsv } from "@/lib/csv";
import { centsToDecimalString } from "@/lib/money";
import { todayKL } from "@/lib/dates";

export async function GET(req: Request) {
  const ctx = await getContext();
  const filters = filtersFromParams(new URL(req.url).searchParams);
  const expenses = await listExpenses(ctx, filters, 10000);
  const catName = new Map(ctx.categories.map((c) => [c.id, c.label]));
  const wsName = new Map(ctx.workspaces.map((w) => [w.id, w.name]));
  const csv = toCsv(
    ["Date", "Time", "Workspace", "Workspace type", "Category", "Merchant", "Description", "Amount", "Currency", "Tax", "Discount", "Entry method", "Notes", "ID"],
    expenses.map((e) => [
      e.date,
      e.time ?? "",
      wsName.get(e.workspaceId) ?? "",
      e.workspaceKind,
      e.categoryId ? catName.get(e.categoryId) ?? "" : "",
      e.merchant ?? "",
      e.description ?? "",
      centsToDecimalString(e.amountCents),
      e.currency,
      e.taxCents !== null ? centsToDecimalString(e.taxCents) : "",
      e.discountCents !== null ? centsToDecimalString(e.discountCents) : "",
      e.entryMethod,
      e.notes ?? "",
      e.id,
    ]),
  );
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="bukutigalima-perbelanjaan-${todayKL()}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
