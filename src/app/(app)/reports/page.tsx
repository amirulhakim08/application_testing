import { getContext, getLedger } from "@/lib/data";
import { getI18n } from "@/lib/i18n/server";
import { elapsedPart, resolvePeriod } from "@/lib/periods";
import { addMonths, startOfMonth, todayKL } from "@/lib/dates";
import { averageDaily, categoryBreakdown, dailySeries, monthlySeries, summarizeWorkspace, weeklySeries, type SeriesPoint } from "@/lib/aggregate";
import { formatMoney } from "@/lib/money";
import { PageHeader } from "@/components/app/page-header";
import { PeriodFilter } from "@/components/app/period-filter";
import { ScopeSwitch, TrendTabs, MonthCompare } from "@/components/app/report-widgets";
import { CategoryBars } from "@/components/app/category-bars";
import { CategoryIcon } from "@/components/app/category-icon";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = { title: "Reports" };

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await getContext();
  const { t } = await getI18n();
  const today = todayKL();
  const period = resolvePeriod(sp.period, { from: sp.from, to: sp.to, today });
  const scope: "all" | "personal" | "company" = sp.ws === "personal" || sp.ws === "company" ? sp.ws : "all";
  const show = scope === "all" ? "both" : scope;

  const yearFrom = startOfMonth(addMonths(startOfMonth(today), -11));
  const from = [period.previous.from, yearFrom].sort()[0];
  const to = [period.current.to, today].sort().at(-1)!;
  const all = await getLedger(ctx, from, to);
  const ledger = scope === "all" ? all : all.filter((r) => r.workspaceKind === scope);

  const personal = summarizeWorkspace(all, "personal", period.current, period.previous, today);
  const company = summarizeWorkspace(all, "company", period.current, period.previous, today);
  const scopedTotal = scope === "personal" ? personal.total : scope === "company" ? company.total : personal.total + company.total;
  const cats = categoryBreakdown(ledger, period.current);
  const catMap = new Map(ctx.categories.map((c) => [c.id, { name: c.name, icon: c.icon }]));
  const wsOfCat = new Map(ctx.categories.map((c) => [c.id, ctx.kindOf(c.workspaceId)]));
  const top = cats[0];
  const mask = (s: SeriesPoint[]) => (scope === "all" ? s : s.map((p) => ({ ...p, [scope === "personal" ? "company" : "personal"]: 0 })));

  const tiles = [
    { label: `${t("ws.personal")} · ${t("dash.totalSpent")}`, value: formatMoney(personal.total), hide: scope === "company" },
    { label: `${ctx.company.name} · ${t("dash.totalSpent")}`, value: formatMoney(company.total), hide: scope === "personal" },
    { label: t("rep.avgDaily"), value: formatMoney(averageDaily(scopedTotal, elapsedPart(period.current, today))) },
    { label: t("rep.topCategories"), value: top ? catMap.get(top.categoryId ?? "")?.name ?? "—" : "—", sub: top ? formatMoney(top.total) : undefined },
  ].filter((x) => !x.hide);

  return (
    <div className="animate-fade-up space-y-5">
      <PageHeader title={t("rep.title")} />
      <div className="grid gap-3">
        <PeriodFilter value={period.key} from={period.current.from} to={period.current.to} />
        <ScopeSwitch value={scope} />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((x) => (
          <Card key={x.label} className="p-4">
            <div className="truncate text-xs text-muted-foreground">{x.label}</div>
            <div className="tabular mt-1 truncate text-xl font-semibold tracking-tight">{x.value}</div>
            {x.sub && <div className="tabular text-xs text-muted-foreground">{x.sub}</div>}
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("rep.trend")}</CardTitle>
        </CardHeader>
        <CardContent>
          {scopedTotal === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">{t("rep.noData")}</p>
          ) : (
            <TrendTabs
              show={show}
              daily={mask(dailySeries(all, period.current))}
              weekly={mask(weeklySeries(all, period.current))}
              monthly={mask(monthlySeries(all, period.current.to, 6))}
            />
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("rep.distribution")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {(scope === "all" ? (["personal", "company"] as const) : ([scope] as const)).map((k) => (
              <div key={k}>
                {scope === "all" && <div className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">{k === "personal" ? t("ws.personal") : ctx.company.name}</div>}
                <CategoryBars slices={categoryBreakdown(all, period.current, k)} categories={catMap} tone={k} limit={12} empty={t("rep.noData")} />
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("rep.topCategories")}</CardTitle>
          </CardHeader>
          <CardContent className="pt-3">
            {cats.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">{t("rep.noData")}</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="pb-2 font-medium">{t("form.category")}</th>
                    <th className="pb-2 text-right font-medium">#</th>
                    <th className="pb-2 text-right font-medium">%</th>
                    <th className="pb-2 text-right font-medium">{t("form.amount")}</th>
                  </tr>
                </thead>
                <tbody>
                  {cats.slice(0, 10).map((c) => {
                    const meta = catMap.get(c.categoryId ?? "");
                    const kind = wsOfCat.get(c.categoryId ?? "");
                    return (
                      <tr key={c.categoryId ?? "none"} className="border-t">
                        <td className="py-2.5">
                          <span className="flex items-center gap-2">
                            <span className="size-2 rounded-full" style={{ background: kind === "company" ? "var(--chart-company)" : "var(--chart-personal)" }} />
                            <CategoryIcon icon={meta?.icon} className="size-4 text-muted-foreground" />
                            {meta?.name ?? "—"}
                          </span>
                        </td>
                        <td className="tabular py-2.5 text-right text-muted-foreground">{c.count}</td>
                        <td className="tabular py-2.5 text-right text-muted-foreground">{Math.round(c.share * 100)}%</td>
                        <td className="tabular py-2.5 text-right font-medium">{formatMoney(c.total)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("rep.monthCompare")}</CardTitle>
        </CardHeader>
        <CardContent>
          <MonthCompare data={mask(monthlySeries(all, today, 12))} show={show} />
        </CardContent>
      </Card>
    </div>
  );
}
