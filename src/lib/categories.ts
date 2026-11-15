import type { WorkspaceKind } from "./aggregate";

export const DEFAULT_CATEGORIES: Record<WorkspaceKind, string[]> = {
  personal: ["Food & Drinks", "Groceries", "Transport", "Bills", "Shopping", "Entertainment", "Healthcare", "Education", "Travel", "Family", "Other"],
  company: ["Supplies", "Inventory Purchases", "Packaging", "Shipping", "Marketing", "Advertising", "Staff Expenses", "Travel", "Software", "Rent", "Utilities", "Professional Fees", "Other"],
};

/**
 * Keyword hints used to suggest a category from free text (voice, merchant names).
 * Keys are default category names. Matching is case-insensitive on word boundaries.
 * Hints are suggestions only; the user always confirms.
 */
export const CATEGORY_HINTS: Record<WorkspaceKind, Record<string, string[]>> = {
  personal: {
    Groceries: ["barang dapur", "groceries", "grocery", "beras", "milo", "gula", "tepung", "telur", "minyak masak", "roti", "susu", "mart", "hypermarket", "supermarket", "pasaraya", "kk mart", "family mart", "familymart", "7-eleven", "barang basah", "pasar", "lotus", "lotus's", "tesco", "mydin", "aeon", "giant", "jaya grocer", "village grocer", "econsave", "speedmart", "99 speedmart", "nsk", "sayur", "ikan", "ayam"],
    "Food & Drinks": ["makan", "makanan", "lunch", "dinner", "breakfast", "sarapan", "makan tengahari", "makan malam", "nasi", "kopi", "coffee", "teh", "mamak", "restoran", "restaurant", "cafe", "kfc", "mcd", "mcdonald", "starbucks", "zus", "tealive", "food", "minum", "drinks", "foodpanda", "grabfood"],
    Transport: ["petrol", "minyak kereta", "minyak", "diesel", "fuel", "grab", "toll", "tol", "parking", "letak kereta", "lrt", "mrt", "bas", "bus", "teksi", "taxi", "touch n go", "tng", "shell", "petronas", "caltex", "bhp", "servis kereta", "car service"],
    Bills: ["bil", "bill", "elektrik", "electric", "tnb", "bil air", "water bill", "internet", "unifi", "maxis", "celcom", "digi", "umobile", "astro", "phone bill", "telefon", "sewa rumah", "insurance", "insurans", "takaful"],
    Shopping: ["shopping", "shopee", "lazada", "baju", "kasut", "shoes", "clothes", "pakaian", "uniqlo", "beli online"],
    Entertainment: ["wayang", "movie", "cinema", "gsc", "tgv", "netflix", "spotify", "game", "games", "karaoke", "konsert", "concert"],
    Healthcare: ["klinik", "clinic", "doktor", "doctor", "ubat", "medicine", "farmasi", "pharmacy", "hospital", "guardian", "watsons", "dental", "gigi"],
    Education: ["yuran", "fees", "sekolah", "school", "buku", "book", "books", "tuisyen", "tuition", "kursus", "course", "universiti"],
    Travel: ["hotel", "flight", "tiket kapal terbang", "airasia", "mas", "malaysia airlines", "bercuti", "holiday", "vacation", "airbnb", "travel"],
    Family: ["anak", "kids", "isteri", "suami", "wife", "husband", "mak", "ayah", "parents", "family", "keluarga", "susu anak", "lampin", "diapers", "nursery", "taska"],
  },
  company: {
    Packaging: ["packaging", "kotak", "box", "boxes", "bubble wrap", "plastik", "plastic bag", "label", "pembungkusan", "tape"],
    Shipping: ["shipping", "courier", "kurier", "pos laju", "poslaju", "j&t", "jnt", "ninja van", "dhl", "postage", "penghantaran", "delivery", "lalamove"],
    Advertising: ["ads", "iklan", "facebook ads", "fb ads", "google ads", "tiktok ads", "advertising", "boost post"],
    Marketing: ["marketing", "pemasaran", "influencer", "promosi", "promotion", "banner", "flyer", "risalah"],
    Supplies: ["supplies", "alat tulis", "stationery", "kertas", "paper", "ink", "dakwat", "printer", "office supplies"],
    "Inventory Purchases": ["stok", "stock", "inventory", "bahan mentah", "raw material", "barang jualan", "borong", "wholesale"],
    "Staff Expenses": ["staff", "pekerja", "gaji", "salary", "elaun", "allowance", "makan staff", "staff lunch"],
    Travel: ["petrol", "minyak", "toll", "tol", "parking", "grab", "flight", "hotel", "travel", "outstation", "perjalanan"],
    Software: ["software", "subscription", "langganan", "saas", "canva", "google workspace", "microsoft", "domain", "hosting", "zoom", "app"],
    Rent: ["rent", "sewa", "sewa kedai", "sewa pejabat", "rental"],
    Utilities: ["utilities", "elektrik", "electric", "tnb", "bil air", "water", "internet", "unifi", "telefon", "phone"],
    "Professional Fees": ["accountant", "akauntan", "lawyer", "peguam", "audit", "consultant", "perunding", "ssm", "legal", "secretary", "setiausaha syarikat"],
  },
};

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Suggest a default category name for free text. Longest keyword match wins. */
export function suggestCategoryName(text: string, kind: WorkspaceKind): string | null {
  const t = ` ${text.toLowerCase()} `;
  let best: { name: string; len: number } | null = null;
  for (const [name, words] of Object.entries(CATEGORY_HINTS[kind])) {
    for (const w of words) {
      const re = new RegExp(`(^|[^a-z0-9])${escapeRe(w)}([^a-z0-9]|$)`, "i");
      if (re.test(t) && (!best || w.length > best.len)) best = { name, len: w.length };
    }
  }
  return best?.name ?? null;
}

/**
 * Map a category from one workspace to the other when a user moves an expense.
 * Same name if it exists (e.g. Travel, Other), otherwise "Other".
 */
export function mapCategoryAcrossWorkspaces<T extends { id: string; name: string; archived?: boolean }>(
  fromName: string | null,
  targetCategories: T[],
): T | null {
  const active = targetCategories.filter((c) => !c.archived);
  if (fromName) {
    const same = active.find((c) => c.name.toLowerCase() === fromName.toLowerCase());
    if (same) return same;
  }
  return active.find((c) => c.name.toLowerCase() === "other") ?? active[0] ?? null;
}
