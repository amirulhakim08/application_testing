/**
 * Decide which receipt amount is the final amount actually paid.
 * The AI proposes candidates; this deterministic layer cross-checks them and
 * never invents a value. Anything uncertain is flagged for manual review.
 */
import { parseToCents, type Cents } from "./money";

export const AMOUNT_KINDS = [
  "final_total",
  "subtotal",
  "tax",
  "service_charge",
  "discount",
  "rounding",
  "cash_tendered",
  "change",
  "card_payment",
  "other",
] as const;
export type AmountKind = (typeof AMOUNT_KINDS)[number];

export interface AmountCandidate {
  label: string;
  amount: string;
  kind: AmountKind;
}

export interface TotalResolution {
  amountCents: Cents | null;
  status: "ok" | "review" | "ambiguous" | "missing";
  /** Distinct plausible totals the user should choose from when ambiguous. */
  options: Cents[];
  reasons: string[];
}

const PAID_KINDS: AmountKind[] = ["final_total", "card_payment"];

export function resolveReceiptTotal(input: {
  finalTotal: string | null;
  finalTotalConfidence: number;
  candidates: AmountCandidate[];
}): TotalResolution {
  const reasons: string[] = [];
  const parsed = input.candidates
    .map((c) => ({ ...c, cents: parseToCents(c.amount) }))
    .filter((c): c is AmountCandidate & { cents: Cents } => c.cents !== null && c.cents >= 0);

  const byKind = (k: AmountKind) => parsed.filter((c) => c.kind === k).map((c) => c.cents);
  const one = (k: AmountKind): Cents | null => {
    const v = [...new Set(byKind(k))];
    return v.length === 1 ? v[0] : null;
  };

  const modelTotal = input.finalTotal ? parseToCents(input.finalTotal) : null;

  // Evidence 1: cash tendered minus change
  const cash = one("cash_tendered");
  const change = one("change");
  const cashMinusChange = cash !== null && change !== null && cash >= change ? cash - change : null;

  // Evidence 2: arithmetic from components
  const subtotal = one("subtotal");
  let computed: Cents | null = null;
  if (subtotal !== null) {
    computed =
      subtotal +
      (one("tax") ?? 0) +
      (one("service_charge") ?? 0) -
      (one("discount") ?? 0) +
      signedRounding(parsed.filter((c) => c.kind === "rounding"));
  }

  const plausible = new Set<Cents>();
  if (modelTotal !== null && modelTotal > 0) plausible.add(modelTotal);
  for (const k of PAID_KINDS) for (const v of byKind(k)) if (v > 0) plausible.add(v);
  if (cashMinusChange !== null && cashMinusChange > 0) plausible.add(cashMinusChange);

  if (plausible.size === 0) {
    reasons.push("no_total_found");
    return { amountCents: null, status: "missing", options: [], reasons };
  }

  // The model must not have picked a non-paid figure.
  const suspicious = modelTotal !== null && parsed.some((c) => c.cents === modelTotal && ["cash_tendered", "change", "tax"].includes(c.kind));
  if (suspicious) reasons.push("total_matches_non_paid_line");

  const corroborated = (v: Cents) => v === cashMinusChange || v === computed;

  if (plausible.size > 1) {
    // Prefer a value corroborated by arithmetic or cash-minus-change when exactly one is.
    const options = [...plausible].sort((a, b) => b - a);
    const backed = options.filter(corroborated);
    reasons.push("multiple_totals");
    return {
      amountCents: backed.length === 1 ? backed[0] : null,
      status: "ambiguous",
      options,
      reasons,
    };
  }

  const [value] = [...plausible];
  if (computed !== null && computed !== value && !corroborated(value)) reasons.push("components_do_not_add_up");
  const lowConfidence = input.finalTotalConfidence < 0.8;
  if (lowConfidence) reasons.push("low_confidence");

  const needsReview = lowConfidence || suspicious || reasons.includes("components_do_not_add_up") || modelTotal === null;
  if (modelTotal === null) reasons.push("total_inferred_from_lines");
  return { amountCents: value, status: needsReview ? "review" : "ok", options: [value], reasons };
}

function signedRounding(rows: Array<{ label: string; cents: Cents }>): Cents {
  if (rows.length !== 1) return 0;
  const r = rows[0];
  // Rounding adjustments are often printed as "-0.02"; parseToCents keeps sign, label may say "(-)".
  return /-|\(-\)|minus|kurang/i.test(r.label) && r.cents > 0 ? -r.cents : r.cents;
}
