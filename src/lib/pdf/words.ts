/**
 * Amount in words for documents, e.g. RM3,200.50 ->
 *   ms: "Ringgit Malaysia Tiga Ribu Dua Ratus dan Sen Lima Puluh Sahaja"
 *   en: "Ringgit Malaysia Three Thousand Two Hundred and Cents Fifty Only"
 */
import type { Cents } from "@/lib/money";

const MS_ONES = ["", "Satu", "Dua", "Tiga", "Empat", "Lima", "Enam", "Tujuh", "Lapan", "Sembilan"];
const EN_ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const EN_TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function msBelowThousand(n: number): string {
  const parts: string[] = [];
  const h = Math.floor(n / 100);
  const rest = n % 100;
  if (h === 1) parts.push("Seratus");
  else if (h > 1) parts.push(`${MS_ONES[h]} Ratus`);
  if (rest >= 20) {
    parts.push(`${MS_ONES[Math.floor(rest / 10)]} Puluh`);
    if (rest % 10) parts.push(MS_ONES[rest % 10]);
  } else if (rest >= 12) parts.push(`${MS_ONES[rest - 10]} Belas`);
  else if (rest === 11) parts.push("Sebelas");
  else if (rest === 10) parts.push("Sepuluh");
  else if (rest > 0) parts.push(MS_ONES[rest]);
  return parts.join(" ");
}

function enBelowThousand(n: number): string {
  const parts: string[] = [];
  const h = Math.floor(n / 100);
  const rest = n % 100;
  if (h) parts.push(`${EN_ONES[h]} Hundred`);
  if (rest >= 20) parts.push(EN_TENS[Math.floor(rest / 10)] + (rest % 10 ? `-${EN_ONES[rest % 10]}` : ""));
  else if (rest > 0) parts.push(EN_ONES[rest]);
  return parts.join(" ");
}

const SCALES_MS = ["", "Ribu", "Juta", "Bilion"];
const SCALES_EN = ["", "Thousand", "Million", "Billion"];

export function integerToWords(n: number, lang: "ms" | "en"): string {
  if (n === 0) return lang === "ms" ? "Kosong" : "Zero";
  const groups: number[] = [];
  let x = Math.floor(n);
  while (x > 0) {
    groups.push(x % 1000);
    x = Math.floor(x / 1000);
  }
  const out: string[] = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i];
    if (!g) continue;
    if (lang === "ms") {
      if (i === 1 && g === 1) out.push("Seribu");
      else out.push(`${msBelowThousand(g)}${SCALES_MS[i] ? ` ${SCALES_MS[i]}` : ""}`);
    } else out.push(`${enBelowThousand(g)}${SCALES_EN[i] ? ` ${SCALES_EN[i]}` : ""}`);
  }
  return out.join(" ");
}

export function amountInWords(cents: Cents, lang: "ms" | "en"): string {
  const ringgit = Math.floor(cents / 100);
  const sen = cents % 100;
  const r = integerToWords(ringgit, lang);
  if (lang === "ms") return `Ringgit Malaysia ${r}${sen ? ` dan Sen ${integerToWords(sen, "ms")}` : ""} Sahaja`;
  return `Ringgit Malaysia ${r}${sen ? ` and Cents ${integerToWords(sen, "en")}` : ""} Only`;
}
