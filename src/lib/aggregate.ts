import { addMonths, daysBetweenInclusive, eachDay, monthKey, startOfMonth, type ISODate } from "./dates";
import { percentChange, sumCents, type Cents } from "./money";
import { inRange, type DateRange } from "./periods";

export type WorkspaceKind = "personal" | "company";

/** A saved, non-deleted expense reduced to the fields needed for reporting. */
export interface LedgerRow {
  id: string;
  workspaceKind: WorkspaceKind;
  categoryId: string | null;
  amountCents: Cents;
  date: ISODate;
}

export interface WorkspaceSummary {
  total: Cents;
  today: Cents;
  count: number;
  previousTotal: Cents;
  changePct: number | null;
}

/** Dedupe defensively by id so a row can never be counted twice. */
export function uniqueRows(rows: LedgerRow[]): LedgerRow[] {
  const seen = new Set<string>();
  const out: LedgerRow[] = [];
  for (const r of rows) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
  }
  return out;
}

export function summarizeWorkspace(
  rows: LedgerRow[],
  kind: WorkspaceKind,
  current: DateRange,
  previous: DateRange,
  today: ISODate,
): WorkspaceSummary {
  const own = uniqueRows(rows).filter((r) => r.workspaceKind === kind);
  const cur = own.filter((r) => inRange(r.date, current));
  const prev = own.filter((r) => inRange(r.date, previous));
  const total = sumCents(cur.map((r) => r.amountCents));
  const previousTotal = sumCents(prev.map((r) => r.amountCents));
  return {
    total,
    today: sumCents(own.filter((r) => r.date === today).map((r) => r.amountCents)),
    count: cur.length,
    previousTotal,
    changePct: percentChange(total, previousTotal),
  };
}

export interface CategorySlice {
  categoryId: string | null;
  total: Cents;
  count: number;
  share: number; // 0..1
}

export function categoryBreakdown(rows: LedgerRow[], range: DateRange, kind?: WorkspaceKind): CategorySlice[] {
  const map = new Map<string | null, { total: Cents; count: number }>();
  let grand = 0;
  for (const r of uniqueRows(rows)) {
    if (kind && r.workspaceKind !== kind) continue;
    if (!inRange(r.date, range)) continue;
    const e = map.get(r.categoryId) ?? { total: 0, count: 0 };
    e.total += r.amountCents;
    e.count += 1;
    map.set(r.categoryId, e);
    grand += r.amountCents;
  }
  return [...map.entries()]
    .map(([categoryId, v]) => ({ categoryId, ...v, share: grand === 0 ? 0 : v.total / grand }))
    .sort((a, b) => b.total - a.total);
}

export interface SeriesPoint {
  key: string;
  personal: Cents;
  company: Cents;
}

export function dailySeries(rows: LedgerRow[], range: DateRange): SeriesPoint[] {
  const days = eachDay(range.from, range.to);
  const idx = new Map(days.map((d, i) => [d, i]));
  const out = days.map((d) => ({ key: d, personal: 0, company: 0 }));
  for (const r of uniqueRows(rows)) {
    const i = idx.get(r.date);
    if (i === undefined) continue;
    out[i][r.workspaceKind] += r.amountCents;
  }
  return out;
}

/** Last `months` calendar months ending with the month of `endDate` (inclusive). */
export function monthlySeries(rows: LedgerRow[], endDate: ISODate, months = 6): SeriesPoint[] {
  const first = startOfMonth(addMonths(startOfMonth(endDate), -(months - 1)));
  const keys: string[] = [];
  for (let i = 0; i < months; i++) keys.push(monthKey(addMonths(first, i)));
  const idx = new Map(keys.map((k, i) => [k, i]));
  const out = keys.map((k) => ({ key: k, personal: 0, company: 0 }));
  for (const r of uniqueRows(rows)) {
    if (r.date > endDate) continue;
    const i = idx.get(monthKey(r.date));
    if (i === undefined) continue;
    out[i][r.workspaceKind] += r.amountCents;
  }
  return out;
}

/** Weekly buckets (Monday start) across the range. */
export function weeklySeries(rows: LedgerRow[], range: DateRange): SeriesPoint[] {
  const daily = dailySeries(rows, range);
  const out: SeriesPoint[] = [];
  for (const p of daily) {
    const wd = new Date(`${p.key}T00:00:00Z`).getUTCDay();
    if (out.length === 0 || wd === 1) out.push({ key: p.key, personal: 0, company: 0 });
    const last = out[out.length - 1];
    last.personal += p.personal;
    last.company += p.company;
  }
  return out;
}

/** Average spend per calendar day in the range (integer cents, rounded half up). */
export function averageDaily(total: Cents, range: DateRange): Cents {
  const days = daysBetweenInclusive(range.from, range.to);
  return days <= 0 ? 0 : Math.round(total / days);
}
