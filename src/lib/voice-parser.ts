/**
 * Deterministic interpreter for spoken expenses in Bahasa Melayu, English and
 * mixed ("rojak") speech. It runs on the server for free before any paid AI
 * call and is also the fallback when no AI provider is configured.
 *
 * Output is always a *proposal*; nothing is saved without user confirmation.
 */
import { addDays, todayKL, weekday, type ISODate } from "./dates";
import { parseToCents, type Cents } from "./money";
import { suggestCategoryName } from "./categories";
import type { WorkspaceKind } from "./aggregate";

export type Confidence = "high" | "medium" | "low" | "missing";

export interface ProposedExpense {
  amountCents: Cents | null;
  currency: string;
  description: string;
  merchant: string | null;
  categoryName: string | null;
  date: ISODate;
  workspace: WorkspaceKind | null;
  confidence: { amount: Confidence; category: Confidence; date: Confidence; workspace: Confidence };
  issues: string[];
  sourceText: string;
}

// ---------------------------------------------------------------------------
// Number words -> digits
// ---------------------------------------------------------------------------
const EN_UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19,
};
const EN_TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const MS_UNITS: Record<string, number> = {
  kosong: 0, satu: 1, dua: 2, tiga: 3, empat: 4, lima: 5, enam: 6, tujuh: 7, lapan: 8, sembilan: 9,
  sepuluh: 10, sebelas: 11,
};

function isNumberWord(w: string): boolean {
  return (
    w in EN_UNITS || w in EN_TENS || w in MS_UNITS ||
    ["hundred", "thousand", "ratus", "ribu", "puluh", "belas", "seratus", "seribu"].includes(w)
  );
}

/** Convert runs of number words into digit strings. Keeps all other tokens. */
export function numberWordsToDigits(text: string): string {
  const tokens = text.split(/(\s+)/); // keep whitespace tokens
  const out: string[] = [];
  let i = 0;
  while (i < tokens.length) {
    const raw = tokens[i];
    const w = raw.toLowerCase().replace(/[^a-z]/g, "");
    const trailing = raw.match(/[.,!?;:]+$/)?.[0] ?? "";
    const startsNumber = isNumberWord(w) || (w === "a" && /^(hundred|thousand)/i.test(tokens[i + 2] ?? ""));
    if (!startsNumber || w === "puluh" || w === "belas") {
      out.push(raw);
      i++;
      continue;
    }
    let total = 0;
    let current = 0;
    let lastUnit = 0;
    let consumed = false;
    let endTrailing = "";
    let j = i;
    while (j < tokens.length) {
      const tok = tokens[j];
      if (/^\s+$/.test(tok)) { j++; continue; }
      const t = tok.toLowerCase().replace(/[^a-z]/g, "");
      const trail = tok.match(/[.,!?;:]+$/)?.[0] ?? "";
      let handled = true;
      if (t === "a" && !consumed) { current += 1; lastUnit = 1; }
      else if (t in EN_UNITS) { current += EN_UNITS[t]; lastUnit = EN_UNITS[t]; }
      else if (t in MS_UNITS) { current += MS_UNITS[t]; lastUnit = MS_UNITS[t] >= 10 ? 0 : MS_UNITS[t]; }
      else if (t in EN_TENS) { current += EN_TENS[t]; lastUnit = 0; }
      else if (t === "puluh" && lastUnit > 0) { current += lastUnit * 9; lastUnit = 0; }
      else if (t === "belas" && lastUnit > 0) { current += 10; lastUnit = 0; }
      else if (t === "hundred" || t === "ratus") { current = (current || 1) * 100; lastUnit = 0; }
      else if (t === "seratus") { current += 100; lastUnit = 0; }
      else if (t === "thousand" || t === "ribu") { total += (current || 1) * 1000; current = 0; lastUnit = 0; }
      else if (t === "seribu") { total += 1000; lastUnit = 0; }
      else if (t === "and" && consumed && isNumberWord((tokens[j + 2] ?? "").toLowerCase().replace(/[^a-z]/g, ""))) { /* "one hundred and five" */ }
      else handled = false;
      if (!handled) break;
      consumed = true;
      endTrailing = trail;
      j++;
      if (trail) break; // punctuation ends the number
    }
    if (!consumed) { out.push(raw); i++; continue; }
    out.push(String(total + current) + endTrailing);
    // re-insert the whitespace that preceded the token we stopped at
    i = j;
    if (i < tokens.length && !/^\s+$/.test(tokens[i]) && out.length) out.push(" ");
    void trailing;
  }
  return out.join("").replace(/\s{2,}/g, " ");
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------
const WEEKDAYS: Record<string, number> = {
  ahad: 0, sunday: 0, isnin: 1, monday: 1, selasa: 2, tuesday: 2, rabu: 3, wednesday: 3,
  khamis: 4, thursday: 4, jumaat: 5, friday: 5, sabtu: 6, saturday: 6,
};
const MONTHS: Record<string, number> = {
  jan: 1, januari: 1, january: 1, feb: 2, februari: 2, february: 2, mac: 3, mar: 3, march: 3,
  apr: 4, april: 4, mei: 5, may: 5, jun: 6, june: 6, jul: 7, julai: 7, july: 7, ogos: 8, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, okt: 10, oct: 10, oktober: 10, october: 10, nov: 11, november: 11,
  dis: 12, dec: 12, disember: 12, december: 12,
};
const MONTH_RE = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join("|");

interface DateHit { date: ISODate; confidence: Confidence; match: string }

function buildDate(y: number, m: number, d: number, today: ISODate, explicitYear: boolean): ISODate | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const iso = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const check = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(check.getTime()) || check.toISOString().slice(0, 10) !== iso) return null;
  if (!explicitYear && iso > today) return buildDate(y - 1, m, d, today, true);
  return iso;
}

export function findDate(text: string, today: ISODate): DateHit | null {
  const t = text.toLowerCase();
  const year = Number(today.slice(0, 4));
  let m: RegExpMatchArray | null;

  if ((m = t.match(/\b(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?\b/))) {
    const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : year;
    const d = buildDate(y, Number(m[2]), Number(m[1]), today, Boolean(m[3])); // Malaysian D/M/Y
    if (d) return { date: d, confidence: "high", match: m[0] };
  }
  if ((m = t.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH_RE})\\b(?:\\s+(\\d{4}))?`)))) {
    const d = buildDate(m[3] ? Number(m[3]) : year, MONTHS[m[2]], Number(m[1]), today, Boolean(m[3]));
    if (d) return { date: d, confidence: "high", match: m[0] };
  }
  if ((m = t.match(new RegExp(`\\b(${MONTH_RE})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(\\d{4}))?`)))) {
    const d = buildDate(m[3] ? Number(m[3]) : year, MONTHS[m[1]], Number(m[2]), today, Boolean(m[3]));
    if (d) return { date: d, confidence: "high", match: m[0] };
  }
  if ((m = t.match(/\b(\d{1,2})\s+(hari\s+(?:lepas|lalu|yang\s+lalu|sudah)|days?\s+ago)\b/))) {
    const n = Number(m[1]);
    if (n <= 60) return { date: addDays(today, -n), confidence: "high", match: m[0] };
  }
  if ((m = t.match(/\b(kelmarin|day before yesterday)\b/))) return { date: addDays(today, -2), confidence: "high", match: m[0] };
  if ((m = t.match(/\b(semalam|yesterday|last night)\b/))) return { date: addDays(today, -1), confidence: "high", match: m[0] };
  if ((m = t.match(/\b(hari\s*ini|harini|today|tadi|pagi tadi|petang tadi|just now|tonight|malam ini)\b/))) {
    return { date: today, confidence: "high", match: m[0] };
  }
  const wd = Object.keys(WEEKDAYS).join("|");
  if ((m = t.match(new RegExp(`\\b(?:(last|on|hari)\\s+)?(${wd})(?:\\s+(lepas|lalu))?\\b`)))) {
    const target = WEEKDAYS[m[2]];
    const strictlyPast = m[1] === "last" || Boolean(m[3]);
    let diff = (weekday(today) - target + 7) % 7;
    if (diff === 0 && strictlyPast) diff = 7;
    return { date: addDays(today, -diff), confidence: "medium", match: m[0] };
  }
  if ((m = t.match(/\b(minggu lepas|last week)\b/))) return { date: addDays(today, -7), confidence: "low", match: m[0] };
  return null;
}

// ---------------------------------------------------------------------------
// Amounts
// ---------------------------------------------------------------------------
interface AmountHit { cents: Cents; explicit: boolean; index: number; length: number }

export function findAmounts(text: string): AmountHit[] {
  const hits: AmountHit[] = [];
  const taken: Array<[number, number]> = [];
  const overlaps = (s: number, e: number) => taken.some(([a, b]) => s < b && e > a);
  const push = (cents: Cents | null, explicit: boolean, index: number, length: number) => {
    if (cents === null || cents <= 0 || overlaps(index, index + length)) return;
    taken.push([index, index + length]);
    hits.push({ cents, explicit, index, length });
  };
  const num = String.raw`(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?`;
  const toCents = (whole: string, frac: string | undefined, k?: string) => {
    const c = parseToCents(`${whole}${frac ? `.${frac}` : ""}`);
    return c === null ? null : k ? c * 1000 : c;
  };
  let m: RegExpExecArray | null;

  // "50 ringgit 50 sen"
  const ringgitSen = /\b(\d+)\s*ringgit\s+(\d{1,2})\s*sen\b/gi;
  while ((m = ringgitSen.exec(text))) push(parseToCents(`${m[1]}.${m[2].padStart(2, "0")}`), true, m.index, m[0].length);

  // "RM85", "RM 1,200.50", "RM2k"
  const prefix = new RegExp(String.raw`\b(?:rm|myr)\s?${num}(k)?\b`, "gi");
  while ((m = prefix.exec(text))) push(toCents(m[1], m[2], m[3]), true, m.index, m[0].length);

  // "85 ringgit", "50 bucks", "2k ringgit", "85rm"
  const suffix = new RegExp(String.raw`\b${num}\s?(k)?\s?(?:ringgit|rm|myr|bucks|hinggit)\b`, "gi");
  while ((m = suffix.exec(text))) push(toCents(m[1], m[2], m[3]), true, m.index, m[0].length);

  // "50 sen"
  const senOnly = /\b(\d{1,2})\s*sen\b/gi;
  while ((m = senOnly.exec(text))) push(parseToCents(`0.${m[1].padStart(2, "0")}`), true, m.index, m[0].length);

  // Bare numbers are only a weak guess.
  const bare = new RegExp(String.raw`(?<![\w/.-])${num}(k)?(?![\w/%-])`, "gi");
  while ((m = bare.exec(text))) push(toCents(m[1], m[2], m[3]), false, m.index, m[0].length);

  return hits.sort((a, b) => a.index - b.index);
}

// ---------------------------------------------------------------------------
// Workspace, merchant, description
// ---------------------------------------------------------------------------
const COMPANY_WORDS = /\b(company|syarikat|office|pejabat|business|bisnes|biz|kedai saya|for work|untuk kerja|claim company|company punya)\b/i;
const PERSONAL_WORDS = /\b(personal|peribadi|sendiri|own use|untuk diri|private)\b/i;

export function findWorkspace(text: string): { kind: WorkspaceKind; match: string } | null {
  const c = text.match(COMPANY_WORDS);
  const p = text.match(PERSONAL_WORDS);
  if (c && p) return (c.index ?? 0) > (p.index ?? 0) ? { kind: "company", match: c[0] } : { kind: "personal", match: p[0] };
  if (c) return { kind: "company", match: c[0] };
  if (p) return { kind: "personal", match: p[0] };
  return null;
}

const STOP_AFTER_MERCHANT = /\b(untuk|for|semalam|yesterday|hari|today|tadi|rm|myr|\d|dan|and|then|lepas|guna|pakai|using|with|sebab|because|on)\b/i;

export function findMerchant(text: string): { merchant: string; match: string } | null {
  const m = text.match(/\b(?:dekat|dkt|kat|di|at|from|dari|in)\s+([A-Za-z][\w'&.-]*(?:\s+[A-Za-z][\w'&.-]*){0,3})/i);
  if (!m) return null;
  let phrase = m[1];
  const stop = phrase.search(STOP_AFTER_MERCHANT);
  if (stop === 0) return null;
  if (stop > 0) phrase = phrase.slice(0, stop);
  phrase = phrase.replace(/[.,!?;:]+$/, "").trim();
  if (!phrase || /^(the|a|an|sana|sini|situ|rumah|home)$/i.test(phrase)) return null;
  return { merchant: titleCase(phrase), match: m[0].slice(0, m[0].indexOf(m[1]) + m[1].indexOf(phrase) + phrase.length) };
}

function titleCase(s: string): string {
  return s
    .split(/\s+/)
    .map((w) => (w.length <= 3 && /^[A-Z&]+$/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

const FILLER = new Set([
  "saya", "aku", "i", "we", "kami", "kita", "beli", "membeli", "bought", "buy", "bayar", "paid", "pay", "spent", "spend",
  "habis", "guna", "untuk", "utk", "for", "the", "a", "an", "of", "on", "ini", "itu", "tu", "je", "jer", "lah", "dah",
  "sudah", "telah", "tadi", "hari", "harini", "today", "semalam", "yesterday", "kelmarin", "my", "our", "some", "few",
  "beberapa", "sikit", "punya", "ke", "pergi", "went", "to", "isi", "top", "up", "total", "jumlah", "dalam", "about", "around",
  "lebih", "kurang", "ringgit", "rm", "myr", "sen", "company", "syarikat", "personal", "peribadi", "sendiri", "dengan", "with",
  "and", "dan", "also", "juga", "then", "lepas", "lalu", "ago", "days", "day", "hari", "minggu", "week", "last", "pagi", "petang", "malam",
]);

function cleanDescription(text: string): string {
  const words = text
    .replace(/[.,!?;:]+/g, " ")
    .split(/\s+/)
    .filter((w) => w && !FILLER.has(w.toLowerCase()) && !/^\d/.test(w));
  const s = words.join(" ").trim().slice(0, 120);
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------
const SEPARATORS = /\s*(?:[,;]|\b(?:dan|and|lepas tu|lepastu|then|also|juga|plus|serta)\b)\s*/i;

export function parseVoiceExpenses(
  transcript: string,
  opts: { today?: ISODate; defaultWorkspace?: WorkspaceKind | null } = {},
): ProposedExpense[] {
  const today = opts.today ?? todayKL();
  const source = transcript.replace(/\s+/g, " ").trim().slice(0, 2000);
  if (!source) return [];
  const normalized = numberWordsToDigits(source);

  // Split into clauses; group clauses so each group contains at most one explicit amount.
  const clauses = normalized.split(SEPARATORS).map((c) => c.trim()).filter(Boolean);
  const explicitTotal = findAmounts(stripDates(normalized, today)).filter((a) => a.explicit).length;
  let groups: string[];
  if (explicitTotal >= 2) {
    groups = [];
    let pending = "";
    for (const c of clauses) {
      const combined = pending ? `${pending} ${c}` : c;
      const hasAmount = findAmounts(stripDates(c, today)).some((a) => a.explicit);
      if (hasAmount) { groups.push(combined); pending = ""; } else { pending = combined; }
    }
    if (pending) {
      if (groups.length) groups[groups.length - 1] += ` ${pending}`;
      else groups.push(pending);
    }
  } else {
    groups = [normalized];
  }

  // Context said in the first expense ("Semalam ...", "Company beli ...") carries forward to
  // later ones; context said in a later expense applies only to that expense.
  const globalDate = findDate(groups[0], today);
  const globalWs = findWorkspace(groups[0]);
  return groups.map((g) => interpretClause(g, { today, globalDate, globalWs, defaultWorkspace: opts.defaultWorkspace ?? null, source }));
}

function stripDates(text: string, today: ISODate): string {
  let t = text;
  for (let i = 0; i < 3; i++) {
    const d = findDate(t, today);
    if (!d) break;
    const idx = t.toLowerCase().indexOf(d.match);
    if (idx < 0) break;
    t = t.slice(0, idx) + " ".repeat(d.match.length) + t.slice(idx + d.match.length);
  }
  return t;
}

function interpretClause(
  clause: string,
  ctx: {
    today: ISODate;
    globalDate: DateHit | null;
    globalWs: { kind: WorkspaceKind; match: string } | null;
    defaultWorkspace: WorkspaceKind | null;
    source: string;
  },
): ProposedExpense {
  const issues: string[] = [];
  const localDate = findDate(clause, ctx.today);
  const dateHit = localDate ?? ctx.globalDate;
  const date = dateHit?.date ?? ctx.today;
  const dateConfidence: Confidence = dateHit ? dateHit.confidence : "medium";

  const wsHit = findWorkspace(clause) ?? ctx.globalWs;
  const workspace = wsHit?.kind ?? ctx.defaultWorkspace;
  const wsConfidence: Confidence = wsHit ? "high" : ctx.defaultWorkspace ? "medium" : "missing";
  if (!workspace) issues.push("workspace_missing");

  const amounts = findAmounts(stripDates(clause, ctx.today));
  const explicit = amounts.filter((a) => a.explicit);
  let amountCents: Cents | null = null;
  let amountConfidence: Confidence = "missing";
  if (explicit.length === 1) {
    amountCents = explicit[0].cents;
    amountConfidence = "high";
  } else if (explicit.length > 1) {
    amountCents = explicit[explicit.length - 1].cents;
    amountConfidence = "low";
    issues.push("amount_ambiguous");
  } else if (amounts.length === 1) {
    amountCents = amounts[0].cents;
    amountConfidence = "low";
    issues.push("amount_unclear");
  } else {
    issues.push(amounts.length > 1 ? "amount_ambiguous" : "amount_missing");
  }

  const merchantHit = findMerchant(clause);
  const merchant = merchantHit?.merchant ?? null;
  const kindForCategory: WorkspaceKind = workspace ?? "personal";
  const categoryName = suggestCategoryName(clause, kindForCategory);

  // Description: remove amount, date, workspace and merchant phrases.
  let rest = clause;
  for (const a of [...amounts].sort((x, y) => y.index - x.index)) {
    rest = rest.slice(0, a.index) + " " + rest.slice(a.index + a.length);
  }
  rest = stripDates(rest, ctx.today);
  if (wsHit) rest = rest.replace(new RegExp(escapeRe(wsHit.match), "ig"), " ");
  if (merchantHit) rest = rest.replace(new RegExp(escapeRe(merchantHit.match), "i"), " ");
  const item = cleanDescription(rest);
  const head = item ? (COMMON_PHRASES[item.toLowerCase()] ?? item) : categoryName || "Expense";
  const description = (merchant ? `${head} at ${merchant}` : head).slice(0, 240);

  return {
    amountCents,
    currency: "MYR",
    description,
    merchant,
    categoryName: categoryName ?? "Other",
    date,
    workspace,
    confidence: { amount: amountConfidence, category: categoryName ? "medium" : "low", date: dateConfidence, workspace: wsConfidence },
    issues,
    sourceText: clause.trim(),
  };
}

/** Common Malay item phrases rendered as short English descriptions. */
const COMMON_PHRASES: Record<string, string> = {
  "barang dapur": "Groceries", "barang basah": "Fresh groceries", "barang": "Items", "minyak": "Petrol",
  "minyak kereta": "Petrol", "makan": "Meal", "makan tengahari": "Lunch", "makan malam": "Dinner",
  "sarapan": "Breakfast", "bil elektrik": "Electricity bill", "bil air": "Water bill", "ubat": "Medicine",
  "kotak": "Boxes", "sewa": "Rent", "sewa kedai": "Shop rent", "gaji": "Salary", "iklan": "Ads",
  "tol": "Toll", "letak kereta": "Parking", "yuran": "Fees", "kopi": "Coffee", "susu anak": "Baby milk",
};

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
