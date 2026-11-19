import type { WorkspaceKind } from "./aggregate";

export const DEFAULT_CATEGORIES: Record<WorkspaceKind, string[]> = {
  personal: ["Food & Drinks", "Groceries", "Fuel", "Transport", "Bills", "Shopping", "Education", "Entertainment", "Healthcare", "Other"],
  company: ["Marketing", "Advertising", "Office Supplies", "Software", "Subscriptions", "Fuel", "Travel", "Equipment", "Utilities", "Maintenance", "Supplier Purchases", "Other"],
};

/**
 * Keyword hints used to suggest a category from free text (voice, merchant names).
 * Keys are default category names. Matching is case-insensitive on word boundaries; the longest keyword wins.
 * Hints are suggestions only; the user always confirms.
 */
export const CATEGORY_HINTS: Record<WorkspaceKind, Record<string, string[]>> = {
  personal: {
    Groceries: ["barang dapur", "groceries", "grocery", "beras", "milo", "gula", "tepung", "telur", "minyak masak", "roti", "susu", "mart", "hypermarket", "supermarket", "pasaraya", "kk mart", "family mart", "familymart", "7-eleven", "barang basah", "pasar", "lotus", "lotus's", "tesco", "mydin", "aeon", "giant", "jaya grocer", "village grocer", "econsave", "speedmart", "99 speedmart", "nsk", "sayur", "ikan", "ayam"],
    "Food & Drinks": ["makan", "makanan", "lunch", "dinner", "breakfast", "sarapan", "makan tengahari", "makan tengah hari", "makan malam", "nasi", "kopi", "coffee", "teh", "mamak", "restoran", "restaurant", "cafe", "kfc", "mcd", "mcdonald", "starbucks", "zus", "tealive", "food", "minum", "drinks", "foodpanda", "grabfood"],
    Fuel: ["petrol", "minyak kereta", "minyak", "isi minyak", "diesel", "fuel", "ron95", "ron97", "shell", "petronas", "caltex", "bhp", "petron"],
    Transport: ["grab", "toll", "tol", "parking", "letak kereta", "lrt", "mrt", "bas", "bus", "teksi", "taxi", "touch n go", "tng", "servis kereta", "car service", "ktm", "ets"],
    Bills: ["bil", "bill", "elektrik", "electric", "tnb", "bil air", "water bill", "internet", "unifi", "maxis", "celcom", "digi", "umobile", "astro", "phone bill", "telefon", "sewa rumah", "insurance", "insurans", "takaful"],
    Shopping: ["shopping", "shopee", "lazada", "baju", "kasut", "shoes", "clothes", "pakaian", "uniqlo", "beli online"],
    Entertainment: ["wayang", "movie", "cinema", "gsc", "tgv", "netflix", "spotify", "game", "games", "karaoke", "konsert", "concert"],
    Healthcare: ["klinik", "clinic", "doktor", "doctor", "ubat", "medicine", "farmasi", "pharmacy", "hospital", "guardian", "watsons", "dental", "gigi"],
    Education: ["yuran", "fees", "sekolah", "school", "buku", "book", "books", "tuisyen", "tuition", "kursus", "course", "universiti"],
  },
  company: {
    Marketing: ["marketing", "pemasaran", "iklan", "ads", "facebook ads", "fb ads", "iklan facebook", "google ads", "tiktok ads", "instagram ads", "boost post", "influencer", "promosi", "promotion"],
    Advertising: ["advertising", "billboard", "papan iklan", "banner", "bunting", "flyer", "risalah", "radio", "akhbar", "newspaper"],
    "Office Supplies": ["barang pejabat", "office supplies", "supplies", "alat tulis", "stationery", "kertas", "paper", "ink", "dakwat", "toner", "printer", "fail", "file"],
    Software: ["software", "perisian", "saas", "canva", "microsoft", "adobe", "domain", "hosting", "app"],
    Subscriptions: ["subscription", "langganan", "google workspace", "zoom", "notion", "slack", "netflix business"],
    Fuel: ["petrol", "minyak", "isi minyak", "diesel", "fuel", "ron95", "shell", "petronas", "caltex", "bhp"],
    Travel: ["toll", "tol", "parking", "grab", "flight", "hotel", "travel", "outstation", "perjalanan", "tiket", "airasia"],
    Equipment: ["equipment", "peralatan", "mesin", "machine", "laptop", "komputer", "computer", "kamera", "camera", "telefon bimbit"],
    Utilities: ["utilities", "elektrik", "electric", "tnb", "bil air", "water", "internet", "unifi", "telefon", "phone"],
    Maintenance: ["maintenance", "penyelenggaraan", "repair", "baiki", "servis", "service", "aircond", "plumber", "tukang"],
    "Supplier Purchases": ["supplier", "pembekal", "stok", "stock", "inventory", "bahan mentah", "raw material", "barang jualan", "borong", "wholesale", "kotak", "packaging", "pembungkusan"],
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
