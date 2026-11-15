/**
 * Turns raw OCR text from a (mostly Malaysian) printed receipt into the same
 * structure the AI provider returns, so it flows through the existing
 * sanitizeReceipt() / resolveReceiptTotal() checks unchanged.
 *
 * It never invents a total: if no total-like line is read, final_total is null.
 * Confidence is capped so OCR results always require the user's review.
 */
import { addDays, isISODate, todayKL, type ISODate } from "@/lib/dates";
import { parseToCents } from "@/lib/money";
import { suggestCategoryName } from "@/lib/categories";
import type { AmountKind } from "@/lib/receipt-total";
import type { ReceiptExtraction } from "@/lib/ai/schemas";

export const OCR_MAX_CONFIDENCE = 0.75;

const MONTHS: Record<string, number> = {
  JAN: 1, JANUARY: 1, JANUARI: 1, FEB: 2, FEBRUARY: 2, FEBRUARI: 2, MAR: 3, MARCH: 3, MAC: 3, APR: 4, APRIL: 4,
  MAY: 5, MEI: 5, JUN: 6, JUNE: 6, JUL: 7, JULY: 7, JULAI: 7, AUG: 8, AUGUST: 8, OGO: 8, OGOS: 8,
  SEP: 9, SEPT: 9, SEPTEMBER: 9, OCT: 10, OCTOBER: 10, OKT: 10, OKTOBER: 10, NOV: 11, NOVEMBER: 11,
  DEC: 12, DECEMBER: 12, DIS: 12, DISEMBER: 12,
};
const MONTH_RE = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join("|");

// Money at the end of a line: "53.00", "RM 1,234.50", "-0.02", "53,00" (OCR comma), O/o read for 0.
const AMOUNT_RE = /(-)?\s*(?:RM\s?)?([0-9Oo]{1,3}(?:,[0-9Oo]{3})+|[0-9Oo]+)\s?[.,]\s?([0-9Oo]{2})(?![0-9])/g;

export interface ParsedLine {
  raw: string;
  label: string;
  amount: string | null; // "53.00"
  negative: boolean;
}

function fixDigits(s: string) {
  return s.replace(/[Oo]/g, "0");
}

export function parseLine(raw: string): ParsedLine {
  const line = raw.replace(/\s+/g, " ").trim();
  let last: RegExpExecArray | null = null;
  let m: RegExpExecArray | null;
  AMOUNT_RE.lastIndex = 0;
  while ((m = AMOUNT_RE.exec(line))) {
    // Must contain at least one real digit (avoid "OO.OO" noise) and not be part of a date like 12.11.2026
    if (!/\d/.test(m[2] + m[3])) continue;
    const after = line.slice(m.index + m[0].length);
    if (/^[./-]\d/.test(after)) continue;
    last = m;
  }
  if (!last) return { raw: line, label: line, amount: null, negative: false };
  const whole = fixDigits(last[2]).replace(/,/g, "");
  const amount = `${Number(whole)}.${fixDigits(last[3])}`;
  const label = (line.slice(0, last.index) + " " + line.slice(last.index + last[0].length)).replace(/\s+/g, " ").trim();
  const negative = Boolean(last[1]) || /\(-\)|\s-$/.test(label);
  return { raw: line, label, amount, negative };
}

/** Classify a summary line by its label. Returns null for ordinary item lines. */
export function classifyLabel(labelRaw: string): AmountKind | "skip" | null {
  const l = ` ${labelRaw.toUpperCase().replace(/[^A-Z0-9%&\-()/ ]/g, " ").replace(/\s+/g, " ")} `;
  const has = (re: RegExp) => re.test(l);
  if (has(/\bTOTAL\b.*\b(QTY|QUANTITY|ITEMS?|PCS|UNITS?|KUANTITI)\b|\b(QTY|ITEMS?)\b.*\bTOTAL\b/)) return "skip";
  if (has(/\bROUND(ING)?\b|\bPEMBUNDARAN\b|\bADJ(USTMENT)?\b/)) return "rounding";
  if (has(/\bCHANGE\b|\bBAKI\b|\bKEMBALI(AN)?\b|\bCHG\b/)) return "change";
  if (has(/\bCASH\b|\bTUNAI\b|\bTENDER(ED)?\b/)) return "cash_tendered";
  if (has(/\b(VISA|MASTER(CARD)?|AMEX|CARD|KAD|DEBIT|CREDIT|TNG|TOUCH ?N ?GO|E-?WALLET|DUITNOW|GRABPAY|BOOST|SHOPEEPAY|QR ?PAY|MYDEBIT)\b/)) return "card_payment";
  if (has(/\bSUB ?-?TOTAL\b|\bJUMLAH KECIL\b|\bTOTAL (EXCL|EXCLUDING|BEFORE)\b/)) return "subtotal";
  if (has(/\bSERVICE (CHARGE|CHG)\b|\bSVC\b|\bCAJ PERKHIDMATAN\b|\bS ?\/ ?C\b/)) return "service_charge";
  if (has(/\bDISC(OUNT)?\b|\bDISKAUN\b|\bSAVINGS?\b|\bPOTONGAN\b|\bVOUCHER\b|\bPROMO\b/)) return "discount";
  const totalWord = /\b(GRAND TOTAL|TOTAL|JUMLAH( BESAR)?|NETT?( TOTAL| AMOUNT)?|AMOUNT DUE|AMT DUE|BALANCE DUE|AMAUN|TOTAL AMOUNT|TOTAL PAYABLE|PAYABLE)\b/;
  const taxWord = /\b(SST|GST|TAX|CUKAI)\b/;
  if (has(totalWord)) {
    if (has(taxWord) && !has(/\b(INCL|INC|INCLUDING|TERMASUK|AFTER|WITH)\b/)) return "tax";
    return "final_total";
  }
  if (has(taxWord)) return "tax";
  return null;
}

function buildDate(y: number, m: number, d: number): ISODate | null {
  const iso = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return isISODate(iso) ? iso : null;
}

/** Explicit dates only (receipts always print a full date). Malaysian order D/M/Y. */
export function findReceiptDate(text: string, today: ISODate): ISODate | null {
  const t = fixDigitsInDates(text.toUpperCase());
  const candidates: ISODate[] = [];
  let m: RegExpExecArray | null;
  const ymd = /\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/g;
  while ((m = ymd.exec(t))) {
    const d = buildDate(+m[1], +m[2], +m[3]);
    if (d) candidates.push(d);
  }
  const dmy = /\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})\b/g;
  while ((m = dmy.exec(t))) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    const d = buildDate(y, +m[2], +m[1]);
    if (d) candidates.push(d);
  }
  const dMonY = new RegExp(String.raw`\b(\d{1,2})[\s\-/.]*(${MONTH_RE})[A-Z]*[\s\-/.,]*(\d{4}|\d{2})\b`, "g");
  while ((m = dMonY.exec(t))) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    const d = buildDate(y, MONTHS[m[2]], +m[1]);
    if (d) candidates.push(d);
  }
  const monDY = new RegExp(String.raw`\b(${MONTH_RE})[A-Z]*[\s\-/.]*(\d{1,2}),?[\s\-/.]*(\d{4})\b`, "g");
  while ((m = monDY.exec(t))) {
    const d = buildDate(+m[3], MONTHS[m[1]], +m[2]);
    if (d) candidates.push(d);
  }
  const max = addDays(today, 1);
  const min = addDays(today, -3650);
  return candidates.find((d) => d <= max && d >= min) ?? null;
}

function fixDigitsInDates(s: string) {
  // "O1/11/2O26" -> "01/11/2026" only inside date-shaped tokens
  return s.replace(/\b[0-9O]{1,4}[-/.][0-9O]{1,2}[-/.][0-9O]{2,4}\b/g, (x) => x.replace(/O/g, "0"));
}

export function findReceiptTime(text: string): string | null {
  // Blank out dates (same length) so "12.11.2026" is not read as 12:11.
  const t = text.replace(/\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/g, (x) => " ".repeat(x.length));
  const re = /\b([01]?\d|2[0-3])([:.])([0-5]\d)(?::[0-5]\d)?\s*(AM|PM)?\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    const ap = m[4]?.toUpperCase();
    // A bare "12.50" is usually money: require ":" unless AM/PM is printed.
    if (m[2] !== ":" && !ap) continue;
    let h = +m[1];
    if (ap === "PM" && h < 12) h += 12;
    if (ap === "AM" && h === 12) h = 0;
    return `${String(h).padStart(2, "0")}:${m[3]}`;
  }
  return null;
}

const NOT_MERCHANT =
  /\b(RECEIPT|RESIT|INVOICE|INVOIS|TAX INVOICE|SIMPLIFIED|TEL|PHONE|FAX|NO\.?|LOT|JALAN|JLN|TAMAN|TMN|WELCOME|SELAMAT|THANK|TERIMA|GST|SST|REG|ROC|CO\.? ?NO|CASHIER|JURUWANG|TABLE|MEJA|ORDER|DATE|TARIKH|TIME|MASA|BILL|COUNTER|POS)\b|\d{5}|@|WWW|HTTP/i;

export function findMerchant(lines: string[]): string | null {
  const head = lines.slice(0, 8).map((l) => l.trim()).filter(Boolean);
  const ok = (l: string) => {
    const letters = (l.match(/[A-Za-z]/g) ?? []).length;
    return letters >= 3 && letters / l.replace(/\s/g, "").length >= 0.6 && !NOT_MERCHANT.test(l);
  };
  const company = head.find((l) => /\b(SDN\.? ?BHD|BHD|ENTERPRISE|ENT\b|TRADING|STORE|MART|RESTORAN|RESTAURANT|CAFE|KEDAI|PLT|HOLDINGS)\b/i.test(l) && ok(l.replace(/\(.*?\)/g, "")));
  const pick = company ?? head.find(ok) ?? null;
  return pick ? pick.replace(/\s+/g, " ").replace(/[|_*=~]+/g, "").trim().slice(0, 120) || null : null;
}

export function parseReceiptText(text: string, opts: { today?: ISODate; ocrConfidence?: number } = {}): ReceiptExtraction {
  const today = opts.today ?? todayKL();
  const conf = Math.min(OCR_MAX_CONFIDENCE, Math.max(0, (opts.ocrConfidence ?? 60) / 100));
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 200);

  const candidates: ReceiptExtraction["amount_candidates"] = [];
  const items: ReceiptExtraction["items"] = [];
  let firstSummaryIdx = Infinity;

  lines.forEach((raw, idx) => {
    const p = parseLine(raw);
    if (!p.amount) return;
    const kind = classifyLabel(p.label);
    if (kind === "skip") return;
    if (kind) {
      firstSummaryIdx = Math.min(firstSummaryIdx, idx);
      const label = (p.label || kind).slice(0, 60) + (kind === "rounding" && p.negative && !/-/.test(p.label) ? " (-)" : "");
      candidates.push({ label, amount: p.amount, kind });
    } else if (idx < firstSummaryIdx && /[A-Za-z]{2}/.test(p.label) && !NOT_MERCHANT.test(p.label)) {
      const qty = /^(\d{1,3})\s*[xX@]\s+|\s[xX]\s?(\d{1,3})\b/.exec(p.label);
      items.push({ name: p.label.replace(/^(\d{1,3})\s*[xX@]\s+/, "").slice(0, 160), quantity: qty ? Number(qty[1] ?? qty[2]) : null, amount: p.amount });
    }
  });

  const finals = candidates.filter((c) => c.kind === "final_total");
  const final = finals.length ? finals[finals.length - 1].amount : null;
  const one = (k: AmountKind) => {
    const v = candidates.filter((c) => c.kind === k);
    return v.length ? v[v.length - 1].amount : null;
  };

  const merchant = findMerchant(lines);
  const date = findReceiptDate(text, today);
  const time = findReceiptTime(text);
  const hintText = [merchant ?? "", ...items.map((i) => i.name)].join(" ");
  const category = suggestCategoryName(hintText, "personal") ?? suggestCategoryName(hintText, "company");

  const warnings: string[] = [];
  if ((opts.ocrConfidence ?? 100) < 55) warnings.push("The photo text was hard to read. Please check every field.");
  if (finals.length === 0) warnings.push("No TOTAL line was found on the receipt.");

  return {
    is_receipt: candidates.length > 0 || items.length >= 2,
    merchant: { value: merchant, confidence: merchant ? conf * 0.9 : 0 },
    date: { value: date, confidence: date ? conf : 0 },
    time: { value: time, confidence: time ? conf : 0 },
    currency: { value: /\bRM\b|\bMYR\b|RINGGIT/i.test(text) ? "MYR" : null, confidence: conf },
    final_total: { value: final, confidence: final ? conf : 0 },
    tax_amount: { value: one("tax"), confidence: one("tax") ? conf : 0 },
    discount_amount: { value: one("discount"), confidence: one("discount") ? conf : 0 },
    amount_candidates: candidates.filter((c) => parseToCents(c.amount) !== null).slice(0, 30),
    suggested_category: category,
    items: items.slice(0, 50),
    warnings,
  };
}
