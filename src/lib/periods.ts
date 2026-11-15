import {
  addDays,
  addMonths,
  daysBetweenInclusive,
  endOfMonth,
  isISODate,
  startOfMonth,
  startOfWeek,
  todayKL,
  type ISODate,
} from "./dates";

export const PERIODS = ["today", "week", "month", "last_month", "custom"] as const;
export type PeriodKey = (typeof PERIODS)[number];

export interface DateRange {
  from: ISODate;
  to: ISODate; // inclusive
}

export interface ResolvedPeriod {
  key: PeriodKey;
  current: DateRange;
  previous: DateRange;
}

/**
 * Resolve a reporting period and its "previous equivalent period".
 * - today      -> yesterday
 * - week       -> the whole calendar week (Mon–Sun, so forward-dated expenses count);
 *                 compared with the same number of elapsed days of the previous week
 * - month      -> the whole calendar month; compared month-to-date with the previous month
 * - last_month -> the month before last (full months)
 * - custom     -> the same-length window immediately before
 */
export function resolvePeriod(
  key: string | undefined,
  opts: { from?: string; to?: string; today?: ISODate } = {},
): ResolvedPeriod {
  const today = opts.today ?? todayKL();
  const k: PeriodKey = (PERIODS as readonly string[]).includes(key ?? "") ? (key as PeriodKey) : "month";

  switch (k) {
    case "today":
      return { key: k, current: { from: today, to: today }, previous: { from: addDays(today, -1), to: addDays(today, -1) } };
    case "week": {
      const from = startOfWeek(today);
      const elapsed = daysBetweenInclusive(from, today);
      const prevFrom = addDays(from, -7);
      return { key: k, current: { from, to: addDays(from, 6) }, previous: { from: prevFrom, to: addDays(prevFrom, elapsed - 1) } };
    }
    case "last_month": {
      const from = startOfMonth(addMonths(startOfMonth(today), -1));
      const prevFrom = startOfMonth(addMonths(from, -1));
      return { key: k, current: { from, to: endOfMonth(from) }, previous: { from: prevFrom, to: endOfMonth(prevFrom) } };
    }
    case "custom": {
      let from = opts.from && isISODate(opts.from) ? opts.from : startOfMonth(today);
      let to = opts.to && isISODate(opts.to) ? opts.to : today;
      if (from > to) [from, to] = [to, from];
      // Guard against absurd ranges (max ~5 years)
      if (daysBetweenInclusive(from, to) > 1830) from = addDays(to, -1829);
      const len = daysBetweenInclusive(from, to);
      return { key: k, current: { from, to }, previous: { from: addDays(from, -len), to: addDays(from, -1) } };
    }
    case "month":
    default: {
      const from = startOfMonth(today);
      const prevFrom = startOfMonth(addMonths(from, -1));
      const elapsed = daysBetweenInclusive(from, today);
      const prevEnd = endOfMonth(prevFrom);
      const prevTo = addDays(prevFrom, elapsed - 1) > prevEnd ? prevEnd : addDays(prevFrom, elapsed - 1);
      return { key: "month", current: { from, to: endOfMonth(today) }, previous: { from: prevFrom, to: prevTo } };
    }
  }
}

export function inRange(date: ISODate, range: DateRange): boolean {
  return date >= range.from && date <= range.to;
}

/** The part of a range that has already happened (for per-day averages). */
export function elapsedPart(range: DateRange, today: ISODate = todayKL()): DateRange {
  return { from: range.from, to: range.to > today ? (today < range.from ? range.from : today) : range.to };
}
