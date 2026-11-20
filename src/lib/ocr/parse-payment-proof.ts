/**
 * Reads the useful bits of a payment proof (DuitNow / bank transfer / e-wallet screenshot) from OCR text:
 * amount, date and the transaction reference. Everything is a suggestion the user can correct.
 */
import { todayKL, type ISODate } from "@/lib/dates";
import { findReceiptDate } from "./parse-receipt-text";

export interface PaymentProofReading {
  amountCents: number | null;
  date: ISODate | null;
  reference: string | null;
}

const AMOUNT_RE = /(?:RM|MYR)\s*:?\s*([0-9]{1,3}(?:[,\s][0-9]{3})*(?:\.[0-9]{2})|[0-9]+\.[0-9]{2})/gi;
const AMOUNT_LABEL = /\b(amount|jumlah|total|amaun|nilai)\b/i;
const REF_LABELS = [
  /reference\s*(?:id|no\.?|number)/i,
  /transaction\s*(?:id|no\.?|ref(?:erence)?)/i,
  /(?:no\.?|nombor)\s*rujukan/i,
  /id\s*transaksi/i,
  /ref(?:erence)?\s*(?:no\.?|#)/i,
  /\bref\b/i,
];
const REF_VALUE = /[A-Z0-9][A-Z0-9\-]{5,39}/i;

function toCents(raw: string): number | null {
  const n = Number(raw.replace(/[,\s]/g, ""));
  if (!Number.isFinite(n) || n <= 0 || n >= 10_000_000) return null;
  return Math.round(n * 100);
}

export function parsePaymentProof(text: string, today: ISODate = todayKL()): PaymentProofReading {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  // Amount: prefer an RM value on (or right after) an "Amount/Jumlah" line, else the largest RM value.
  let amountCents: number | null = null;
  const all: number[] = [];
  lines.forEach((line, i) => {
    const found = [...line.matchAll(AMOUNT_RE)].map((m) => toCents(m[1])).filter((c): c is number => c !== null);
    all.push(...found);
    if (amountCents === null && AMOUNT_LABEL.test(line)) {
      const here = found[0] ?? [...(lines[i + 1] ?? "").matchAll(AMOUNT_RE)].map((m) => toCents(m[1])).find((c) => c !== null);
      if (here) amountCents = here;
    }
  });
  if (amountCents === null && all.length) amountCents = Math.max(...all);

  // Reference: value after a known label on the same line, or on the next line.
  let reference: string | null = null;
  outer: for (const label of REF_LABELS) {
    for (let i = 0; i < lines.length; i++) {
      const m = label.exec(lines[i]);
      if (!m) continue;
      const rest = lines[i].slice(m.index + m[0].length).replace(/^[\s:#.\-]+/, "");
      const v = REF_VALUE.exec(rest) ?? REF_VALUE.exec(lines[i + 1] ?? "");
      if (v && /\d/.test(v[0])) {
        reference = v[0].toUpperCase();
        break outer;
      }
    }
  }

  return { amountCents, date: findReceiptDate(text, today), reference };
}
