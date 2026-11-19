/**
 * Sales document math in integer sen. The database (supabase/migrations/*_sales.sql, price_items/price_charges)
 * is authoritative and stores the totals; this module mirrors the same rules for live preview in the editor and
 * for derived values (payment status, overdue days, reminder text). All rounding is half-up (amounts are positive),
 * matching PostgreSQL's numeric round().
 */
import { daysBetweenInclusive, type ISODate } from "./dates";
import { centsToDecimalString, formatMoney, parseToCents, type Cents } from "./money";

export interface LineInput {
  quantity: string; // up to 3 decimals
  unitPrice: string; // RM, up to 2 decimals
  discount?: string; // RM, up to 2 decimals
  taxRate?: string; // percent, up to 2 decimals
}
export interface ChargeInput {
  label: string;
  kind: "percent" | "fixed";
  value: string;
}
export interface PricedLine {
  gross: Cents;
  discount: Cents;
  subtotal: Cents;
  tax: Cents;
  total: Cents;
  error: string | null;
}
export interface DocumentTotals {
  lines: PricedLine[];
  charges: Array<{ label: string; kind: "percent" | "fixed"; value: string; amount: Cents }>;
  subtotal: Cents;
  discountTotal: Cents;
  chargesTotal: Cents;
  taxTotal: Cents;
  total: Cents;
  valid: boolean;
}

/** Parse a non-negative decimal with at most `places` decimals into an integer scaled by 10^places. */
export function parseScaled(input: string | number | null | undefined, places: number): bigint | null {
  if (input === null || input === undefined) return null;
  const s = String(input).trim().replace(/,/g, "");
  if (s === "") return null;
  const m = /^(\d{1,12})(?:\.(\d*))?$/.exec(s);
  if (!m) return null;
  const frac = m[2] ?? "";
  if (frac.length > places) return null;
  return BigInt(m[1]) * 10n ** BigInt(places) + BigInt((frac + "0".repeat(places)).slice(0, places) || "0");
}

/** Half-up division of non-negative bigints. */
function divRound(n: bigint, d: bigint): bigint {
  return (n * 2n + d) / (2n * d);
}

export function priceLine(l: LineInput): PricedLine {
  const q = parseScaled(l.quantity, 3); // thousandths
  const p = parseScaled(l.unitPrice, 2); // sen
  const d = l.discount?.trim() ? parseScaled(l.discount, 2) : 0n;
  const r = l.taxRate?.trim() ? parseScaled(l.taxRate, 2) : 0n; // hundredths of a percent
  const zero = { gross: 0, discount: 0, subtotal: 0, tax: 0, total: 0 };
  if (q === null || q <= 0n) return { ...zero, error: "quantity" };
  if (p === null) return { ...zero, error: "price" };
  if (d === null) return { ...zero, error: "discount" };
  if (r === null || r > 10000n) return { ...zero, error: "tax" };
  const gross = divRound(q * p, 1000n);
  if (d > gross) return { ...zero, gross: Number(gross), error: "discount" };
  const sub = gross - d;
  const tax = divRound(sub * r, 10000n);
  return { gross: Number(gross), discount: Number(d), subtotal: Number(sub), tax: Number(tax), total: Number(sub + tax), error: null };
}

export function priceDocument(lines: LineInput[], charges: ChargeInput[] = []): DocumentTotals {
  const priced = lines.map(priceLine);
  const subtotal = priced.reduce((a, l) => a + l.gross, 0);
  const discountTotal = priced.reduce((a, l) => a + l.discount, 0);
  const taxTotal = priced.reduce((a, l) => a + l.tax, 0);
  const base = BigInt(subtotal - discountTotal);
  let chargesValid = true;
  const pricedCharges = charges.map((c) => {
    const v = parseScaled(c.value, 2);
    if (v === null || !c.label.trim() || (c.kind === "percent" && v > 10000n)) {
      chargesValid = false;
      return { ...c, amount: 0 };
    }
    const amount = c.kind === "percent" ? Number(divRound(base * v, 10000n)) : Number(v);
    return { ...c, amount };
  });
  const chargesTotal = pricedCharges.reduce((a, c) => a + c.amount, 0);
  return {
    lines: priced,
    charges: pricedCharges,
    subtotal,
    discountTotal,
    chargesTotal,
    taxTotal,
    total: subtotal - discountTotal + chargesTotal + taxTotal,
    valid: lines.length > 0 && priced.every((l) => !l.error) && chargesValid,
  };
}

// ---------------------------------------------------------------- statuses

export type PaymentStatus = "unpaid" | "partial" | "paid";

export function paymentStatus(totalCents: Cents, paidCents: Cents): PaymentStatus {
  if (paidCents <= 0) return "unpaid";
  if (paidCents >= totalCents) return "paid";
  return "partial";
}

/** Days past the due date (0 when not overdue). Overdue never hides whether an invoice is partly paid. */
export function daysOverdue(dueDate: ISODate | null, today: ISODate, outstandingCents: Cents): number {
  if (!dueDate || outstandingCents <= 0 || dueDate >= today) return 0;
  return daysBetweenInclusive(dueDate, today) - 1;
}

export type QuotationDisplayStatus = "draft" | "sent" | "accepted" | "rejected" | "expired";

export function quotationDisplayStatus(status: "draft" | "sent" | "accepted" | "rejected", validUntil: ISODate | null, today: ISODate): QuotationDisplayStatus {
  if ((status === "draft" || status === "sent") && validUntil && validUntil < today) return "expired";
  return status;
}

// ---------------------------------------------------------------- reminders

/** Normalise a Malaysian phone number for wa.me (digits only, country code 60). Returns null if unusable. */
export function whatsappNumber(phone: string | null | undefined): string | null {
  if (!phone) return null;
  let d = phone.replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("0")) d = `6${d}`;
  if (!d.startsWith("60") && d.length <= 10) d = `60${d}`;
  return d.length >= 10 && d.length <= 15 ? d : null;
}

export function reminderMessage(opts: { lang: "ms" | "en"; number: string; outstandingCents: Cents; businessName: string; dueDate?: ISODate | null }) {
  const amt = formatMoney(opts.outstandingCents);
  if (opts.lang === "en") {
    return `Hello. This is a friendly reminder that invoice ${opts.number} still has an outstanding balance of ${amt}. Thank you. — ${opts.businessName}`;
  }
  return `Assalamualaikum / Salam sejahtera. Ini adalah peringatan mesra bahawa invois ${opts.number} masih mempunyai baki ${amt}. Terima kasih. — ${opts.businessName}`;
}

export function whatsappLink(phone: string | null | undefined, text: string): string {
  const n = whatsappNumber(phone);
  return `https://wa.me/${n ?? ""}?text=${encodeURIComponent(text)}`;
}

/** DB numeric (string) -> cents, defaulting to 0. */
export function sen(v: unknown): Cents {
  return parseToCents(v as string) ?? 0;
}
export function rm(cents: Cents): string {
  return centsToDecimalString(cents);
}
