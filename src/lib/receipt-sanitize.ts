import { isISODate, addDays, type ISODate } from "@/lib/dates";
import { parseToCents, type Cents } from "@/lib/money";
import { resolveReceiptTotal, type TotalResolution } from "@/lib/receipt-total";
import type { ReceiptExtraction } from "@/lib/ai/schemas";

export interface Field<T> {
  value: T | null;
  confidence: number;
}

export interface SanitizedReceipt {
  isReceipt: boolean;
  merchant: Field<string>;
  date: Field<ISODate>;
  time: Field<string>;
  currency: Field<string>;
  total: TotalResolution & { confidence: number };
  tax: Field<Cents>;
  discount: Field<Cents>;
  categoryName: string | null;
  items: Array<{ name: string; quantity: number | null; amount: string | null }>;
  warnings: string[];
  overallConfidence: number;
  needsReview: boolean;
}

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);
const cleanText = (s: string | null, max: number) => (s ? s.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) || null : null);

/**
 * Treat model output as untrusted: re-validate every field, drop anything
 * malformed, and restrict the category to the user's own list.
 */
export function sanitizeReceipt(x: ReceiptExtraction, today: ISODate, allowedCategories: string[]): SanitizedReceipt {
  const total = resolveReceiptTotal({
    finalTotal: x.final_total.value,
    finalTotalConfidence: clamp01(x.final_total.confidence),
    candidates: (x.amount_candidates ?? []).slice(0, 30).map((c) => ({ label: cleanText(c.label, 60) ?? "", amount: c.amount, kind: c.kind })),
  });

  let date: Field<ISODate> = { value: null, confidence: 0 };
  if (x.date.value && isISODate(x.date.value) && x.date.value <= addDays(today, 1) && x.date.value >= addDays(today, -3650)) {
    date = { value: x.date.value, confidence: clamp01(x.date.confidence) };
  }
  const time = x.time.value && /^([01]\d|2[0-3]):[0-5]\d$/.test(x.time.value) ? { value: x.time.value, confidence: clamp01(x.time.confidence) } : { value: null, confidence: 0 };
  const currencyValue = x.currency.value && /^[A-Z]{3}$/.test(x.currency.value.toUpperCase()) ? x.currency.value.toUpperCase() : null;
  const money = (f: { value: string | null; confidence: number }): Field<Cents> => {
    const c = f.value ? parseToCents(f.value) : null;
    return c !== null && c >= 0 ? { value: c, confidence: clamp01(f.confidence) } : { value: null, confidence: 0 };
  };
  const categoryName = allowedCategories.find((c) => c.toLowerCase() === (x.suggested_category ?? "").toLowerCase()) ?? null;
  const items = (x.items ?? [])
    .slice(0, 50)
    .map((i) => ({
      name: cleanText(i.name, 160) ?? "",
      quantity: typeof i.quantity === "number" && i.quantity > 0 && i.quantity < 100000 ? i.quantity : null,
      amount: i.amount && parseToCents(i.amount) !== null ? i.amount : null,
    }))
    .filter((i) => i.name);

  const totalConfidence = clamp01(x.final_total.confidence);
  const merchant = { value: cleanText(x.merchant.value, 120), confidence: clamp01(x.merchant.confidence) };
  const overall = Math.min(totalConfidence, merchant.value ? merchant.confidence : 1, date.value ? date.confidence : 0.5);
  const warnings = (x.warnings ?? []).slice(0, 5).map((w) => cleanText(w, 140) ?? "").filter(Boolean);
  if (currencyValue && currencyValue !== "MYR") warnings.push(`Receipt currency appears to be ${currencyValue}; amounts are recorded in MYR.`);

  return {
    isReceipt: Boolean(x.is_receipt),
    merchant,
    date,
    time,
    currency: { value: currencyValue ?? "MYR", confidence: currencyValue ? clamp01(x.currency.confidence) : 0.5 },
    total: { ...total, confidence: totalConfidence },
    tax: money(x.tax_amount),
    discount: money(x.discount_amount),
    categoryName,
    items,
    warnings,
    overallConfidence: Math.round(overall * 1000) / 1000,
    needsReview: total.status !== "ok" || overall < 0.8 || !x.is_receipt || (currencyValue !== null && currencyValue !== "MYR"),
  };
}
