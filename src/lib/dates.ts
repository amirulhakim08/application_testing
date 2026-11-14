/**
 * Reporting dates are calendar dates in Asia/Kuala_Lumpur (UTC+8, no DST).
 * Dates are represented as "YYYY-MM-DD" strings to avoid timezone drift.
 */
export const REPORT_TZ = "Asia/Kuala_Lumpur";

export type ISODate = string; // YYYY-MM-DD

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isISODate(s: string): s is ISODate {
  if (!ISO_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Today's date in Kuala Lumpur. */
export function todayKL(now: Date = new Date()): ISODate {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: REPORT_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function addDays(date: ISODate, days: number): ISODate {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function addMonths(date: ISODate, months: number): ISODate {
  const [y, m, d] = date.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

/** 0 = Sunday ... 6 = Saturday */
export function weekday(date: ISODate): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

export function startOfMonth(date: ISODate): ISODate {
  return `${date.slice(0, 7)}-01`;
}

export function endOfMonth(date: ISODate): ISODate {
  return addDays(startOfMonth(addMonths(startOfMonth(date), 1)), -1);
}

/** ISO week: Monday start (Malaysian convention). */
export function startOfWeek(date: ISODate): ISODate {
  const wd = weekday(date);
  return addDays(date, -((wd + 6) % 7));
}

/** Inclusive number of days between two dates. */
export function daysBetweenInclusive(from: ISODate, to: ISODate): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000) + 1;
}

export function eachDay(from: ISODate, to: ISODate): ISODate[] {
  const out: ISODate[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export function monthKey(date: ISODate): string {
  return date.slice(0, 7);
}

export function formatDateLabel(date: ISODate, locale: "en" | "ms" = "en", opts?: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(locale === "ms" ? "ms-MY" : "en-MY", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
    year: "numeric",
    ...opts,
  }).format(new Date(`${date}T00:00:00Z`));
}
