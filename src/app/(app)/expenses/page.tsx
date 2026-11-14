import { getContext, listExpenses, toRowData } from "@/lib/data";
import { getI18n } from "@/lib/i18n/server";
import { filtersFromParams } from "@/lib/expense-filters";
import { formatDateLabel, todayKL, addDays } from "@/lib/dates";
import { formatMoney, sumCents } from "@/lib/money";
import { PageHeader } from "@/components/app/page-header";
import { ExpenseFilterBar } from "@/components/app/expense-filters";
import { ExpenseRow } from "@/components/app/expense-row";
import { Card } from "@/components/ui/card";

export const metadata = { title: "Expenses" };
const LIMIT = 300;

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await getContext();
  const { t, lang } = await getI18n();
  const filters = filtersFromParams(sp);
  const expenses = await listExpenses(ctx, filters, LIMIT);
  const today = todayKL();

  const groups = new Map<string, typeof expenses>();
  for (const e of expenses) groups.set(e.date, [...(groups.get(e.date) ?? []), e]);
  const dayLabel = (d: string) => (d === today ? t("period.today") : d === addDays(today, -1) ? (lang === "ms" ? "Semalam" : "Yesterday") : formatDateLabel(d, lang, { weekday: "short" }));
  const total = sumCents(expenses.map((e) => e.amountCents));

  return (
    <div className="animate-fade-up">
      <PageHeader title={t("exp.title")} />
      <ExpenseFilterBar />
      {expenses.length > 0 && (
        <div className="mt-4 flex items-baseline justify-between px-1 text-sm text-muted-foreground">
          <span>{expenses.length === 1 ? t("dash.transaction") : t("dash.transactions", { n: expenses.length })}</span>
          <span>
            {t("exp.total")}: <span className="tabular font-semibold text-foreground">{formatMoney(total)}</span>
          </span>
        </div>
      )}
      <div className="mt-3 grid gap-4">
        {expenses.length === 0 && <Card className="p-10 text-center text-sm text-muted-foreground">{t("exp.empty")}</Card>}
        {[...groups.entries()].map(([date, list]) => (
          <section key={date}>
            <div className="mb-1.5 flex items-baseline justify-between px-2 text-[13px] font-medium text-muted-foreground">
              <h2>{dayLabel(date)}</h2>
              <span className="tabular">{formatMoney(sumCents(list.map((e) => e.amountCents)))}</span>
            </div>
            <Card className="p-1.5 sm:p-2">
              {list.map((e) => (
                <ExpenseRow key={e.id} e={toRowData(ctx, e)} t={t} lang={lang} showDate={false} />
              ))}
            </Card>
          </section>
        ))}
        {expenses.length === LIMIT && <p className="text-center text-xs text-muted-foreground">Showing the latest {LIMIT}. Narrow the filters or export CSV for everything.</p>}
      </div>
    </div>
  );
}
