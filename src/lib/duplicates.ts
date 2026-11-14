import type { ISODate } from "./dates";
import { addDays } from "./dates";
import type { Cents } from "./money";

export interface DuplicateProbe {
  amountCents: Cents;
  date: ISODate;
  merchant: string | null;
  imageSha256?: string | null;
  excludeId?: string;
}

export interface ExistingExpense {
  id: string;
  amountCents: Cents;
  date: ISODate;
  merchant: string | null;
  description: string | null;
  imageSha256: string | null;
}

export type DuplicateLevel = "exact_image" | "likely" | "possible";

export interface DuplicateMatch {
  expense: ExistingExpense;
  level: DuplicateLevel;
}

export function normalizeMerchant(s: string | null | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/\b(sdn\.?\s*bhd\.?|bhd|enterprise|ent|trading|store|stores|restaurant|restoran|the|plt|m\)|\(m)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function merchantsSimilar(a: string | null, b: string | null): boolean {
  const x = normalizeMerchant(a);
  const y = normalizeMerchant(b);
  if (!x || !y) return false;
  if (x === y || x.includes(y) || y.includes(x)) return true;
  const ta = new Set(x.split(" ").filter((w) => w.length > 2));
  const tb = new Set(y.split(" ").filter((w) => w.length > 2));
  let common = 0;
  for (const w of ta) if (tb.has(w)) common++;
  return common > 0 && common >= Math.min(ta.size, tb.size) / 2;
}

/** Highest-signal matches first. */
export function findDuplicates(probe: DuplicateProbe, existing: ExistingExpense[]): DuplicateMatch[] {
  const out: DuplicateMatch[] = [];
  const near = new Set([addDays(probe.date, -1), probe.date, addDays(probe.date, 1)]);
  for (const e of existing) {
    if (e.id === probe.excludeId) continue;
    if (probe.imageSha256 && e.imageSha256 && probe.imageSha256 === e.imageSha256) {
      out.push({ expense: e, level: "exact_image" });
      continue;
    }
    if (e.amountCents !== probe.amountCents) continue;
    const sameMerchant = merchantsSimilar(probe.merchant, e.merchant ?? e.description);
    if (e.date === probe.date && sameMerchant) out.push({ expense: e, level: "likely" });
    else if (near.has(e.date) && (sameMerchant || !probe.merchant || !e.merchant)) out.push({ expense: e, level: "possible" });
  }
  const rank: Record<DuplicateLevel, number> = { exact_image: 0, likely: 1, possible: 2 };
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
}
