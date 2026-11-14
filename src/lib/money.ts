/**
 * Exact money handling. All arithmetic is done on integer minor units (sen)
 * using BigInt-safe integers; never on floating point amounts.
 */
export type Cents = number; // integer, always Number.isSafeInteger

const MAX_CENTS = 99_999_999_999; // < numeric(14,2) limit

/** Parse "85", "85.5", "1,234.50", "RM 12.30" into integer cents. Returns null when invalid. */
export function parseToCents(input: string | number | null | undefined): Cents | null {
  if (input === null || input === undefined) return null;
  let s = typeof input === "number" ? numberToPlainString(input) : String(input);
  s = s.trim().replace(/^(rm|myr)\s*/i, "").replace(/\s+/g, "");
  if (s === "") return null;
  // Thousands separators: allow "1,234.50" but reject "1,2"
  if (/,/.test(s)) {
    if (!/^\d{1,3}(,\d{3})+(\.\d*)?$/.test(s)) return null;
    s = s.replace(/,/g, "");
  }
  const m = /^(-)?(\d+)(?:\.(\d*))?$/.exec(s);
  if (!m) return null;
  const [, neg, whole, fracRaw = ""] = m;
  if (fracRaw.length > 2) {
    // Round half up on the third decimal (e.g. 1.005 -> 1.01)
    const frac2 = fracRaw.slice(0, 2).padEnd(2, "0");
    let cents = Number(whole) * 100 + Number(frac2);
    if (Number(fracRaw[2]) >= 5) cents += 1;
    if (!Number.isSafeInteger(cents) || cents > MAX_CENTS) return null;
    return neg ? -cents : cents;
  }
  const cents = Number(whole) * 100 + Number(fracRaw.padEnd(2, "0") || "0");
  if (!Number.isSafeInteger(cents) || cents > MAX_CENTS) return null;
  return neg ? -cents : cents;
}

function numberToPlainString(n: number): string {
  if (!Number.isFinite(n)) return "";
  // toFixed(3) avoids exponent notation and float noise like 0.1+0.2
  return n.toFixed(3);
}

/** Integer cents -> "1234.50" (DB numeric string). */
export function centsToDecimalString(cents: Cents): string {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const s = `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
  return neg ? `-${s}` : s;
}

export function sumCents(values: Iterable<Cents>): Cents {
  let total = 0;
  for (const v of values) total += v;
  return total;
}

export function formatMoney(cents: Cents, currency = "MYR", locale = "en-MY"): string {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, "0");
  const grouped = whole.toLocaleString(locale === "ms" ? "ms-MY" : "en-MY");
  const symbol = currency === "MYR" ? "RM" : `${currency} `;
  return `${neg ? "-" : ""}${symbol}${grouped}.${frac}`;
}

/** Compact form for charts: RM1.2k */
export function formatMoneyCompact(cents: Cents, currency = "MYR"): string {
  const symbol = currency === "MYR" ? "RM" : `${currency} `;
  const v = cents / 100;
  if (Math.abs(v) >= 1_000_000) return `${symbol}${(v / 1_000_000).toFixed(1)}m`;
  if (Math.abs(v) >= 1_000) return `${symbol}${(v / 1_000).toFixed(1)}k`;
  return `${symbol}${Math.round(v)}`;
}

/**
 * Percentage change from previous to current, as a rounded number with 1 decimal.
 * Returns null when there is no previous spending (change is undefined).
 */
export function percentChange(current: Cents, previous: Cents): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}
