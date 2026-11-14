import { isISODate } from "@/lib/dates";
import { parseToCents } from "@/lib/money";
import type { ExpenseFilters } from "@/lib/data";

export function filtersFromParams(sp: Record<string, string | string[] | undefined> | URLSearchParams): ExpenseFilters {
  const get = (k: string) => {
    const v = sp instanceof URLSearchParams ? sp.get(k) : sp[k];
    return (Array.isArray(v) ? v[0] : v) ?? undefined;
  };
  const f: ExpenseFilters = {};
  const q = get("q");
  if (q) f.q = q.slice(0, 60);
  const ws = get("ws");
  if (ws === "personal" || ws === "company") f.ws = ws;
  const cat = get("category");
  if (cat && /^[0-9a-f-]{36}$/i.test(cat)) f.category = cat;
  const from = get("from");
  if (from && isISODate(from)) f.from = from;
  const to = get("to");
  if (to && isISODate(to)) f.to = to;
  const min = get("min");
  if (min) {
    const c = parseToCents(min);
    if (c !== null && c >= 0) f.min = c;
  }
  const max = get("max");
  if (max) {
    const c = parseToCents(max);
    if (c !== null && c >= 0) f.max = c;
  }
  return f;
}
