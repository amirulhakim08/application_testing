import Link from "next/link";
import { Camera, ChevronRight, Mic, PenLine } from "lucide-react";
import { getContext, getLedger, listExpenses, toRowData } from "@/lib/data";
import { getI18n } from "@/lib/i18n/server";
import { resolvePeriod } from "@/lib/periods";
import { addMonths, formatDateLabel, startOfMonth, todayKL } from "@/lib/dates";
import { categoryBreakdown, monthlySeries, summarizeWorkspace } from "@/lib/aggregate";
import { PeriodFilter } from "@/components/app/period-filter";
import { WorkspaceCard } from "@/components/app/workspace-card";
import { ExpenseRow } from "@/components/app/expense-row";
import { CategoryBars } from "@/components/app/category-bars";
import { MonthlyBars } from "@/components/app/charts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = { title: "Ringkasan Perbelanjaan" };

export default async function ExpenseSummary({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await getContext();
  const { t, lang } = await getI18n();
  const today = todayKL();
  const period = resolvePeriod(sp.period, { from: sp.from, to: sp.to, today });

  const trendFrom = startOfMonth(addMonths(startOfMonth(today), -5));
  const from = [period.previous.from, trendFrom].sort()[0];
  const to = [period.current.to, today].sort().at(-1)!;
  const [ledger, recent] = await Promise.all([getLedger(ctx, from, to), listExpenses(ctx, {}, 6)]);

  const personal = summarizeWorkspace(ledger, "personal", period.current, period.previous, today);
  const company = summarizeWorkspace(ledger, "company", period.current, period.previous, today);
  const catMap = new Map(ctx.categories.map((c) => [c.id, { name: c.label, icon: c.icon }]));
  const firstName = ctx.user.fullName?.split(" ")[0];

  return (
    <div className="animate-fade-up space-y-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">{formatDateLabel(today, lang, { weekday: "long", day: "numeric", month: "long", year: undefined })}</p>
          <h1 className="text-[28px] font-semibold tracking-tight">{t("dash.greeting", { name: firstName ? `, ${firstName}` : "" })}</h1>
        </div>
      </header>

      <PeriodFilter value={period.key} from={period.current.from} to={period.current.to} />

      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        <WorkspaceCard kind="personal" name={t("ws.personal")} summary={personal} t={t} />
        <WorkspaceCard kind="company" name={ctx.company.name} summary={company} t={t} />
      </div>
      <p className="-mt-3 text-center text-[11px] text-muted-foreground">{t("dash.spendingNote")}</p>

      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        {[
          { href: "/add/scan", icon: Camera, label: t("add.scan") },
          { href: "/add/voice", icon: Mic, label: t("add.voice") },
          { href: "/add/manual", icon: PenLine, label: t("add.manual") },
        ].map((a) => (
          <Link
            key={a.href}
            href={a.href}
            className="flex flex-col items-center gap-2 rounded-2xl border bg-card px-2 py-4 text-center text-[13px] font-medium shadow-sm transition-all hover:border-primary/40 active:scale-[0.98] sm:flex-row sm:justify-center sm:text-sm"
          >
            <span className="grid size-10 place-items-center rounded-full bg-primary-soft text-primary">
              <a.icon className="size-5" />
            </span>
            {a.label}
          </Link>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>{t("dash.recent")}</CardTitle>
            <Link href="/expenses" className="flex items-center text-sm font-medium text-primary">
              {t("dash.viewAll")} <ChevronRight className="size-4" />
            </Link>
          </CardHeader>
          <CardContent className="px-2 pt-2 sm:px-3">
            {recent.length === 0 ? (
              <p className="px-3 py-8 text-center text-sm text-muted-foreground">{t("dash.empty")}</p>
            ) : (
              recent.map((e) => <ExpenseRow key={e.id} e={toRowData(ctx, e)} t={t} lang={lang} />)
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{t("dash.breakdown")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div>
              <div className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">{t("ws.personal")}</div>
              <CategoryBars slices={categoryBreakdown(ledger, period.current, "personal")} categories={catMap} tone="personal" limit={4} empty={t("rep.noData")} />
            </div>
            <div>
              <div className="mb-3 truncate text-xs font-medium uppercase tracking-wider text-muted-foreground">{ctx.company.name}</div>
              <CategoryBars slices={categoryBreakdown(ledger, period.current, "company")} categories={catMap} tone="company" limit={4} empty={t("rep.noData")} />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("dash.trend")}</CardTitle>
        </CardHeader>
        <CardContent>
          <MonthlyBars data={monthlySeries(ledger, today, 6)} />
        </CardContent>
      </Card>
    </div>
  );
}
