import type { Lang } from "@/lib/i18n";

/**
 * Display names for the default categories created at sign-up (see supabase/migrations/*_init.sql).
 * Stored names stay in English so voice/receipt matching keeps working; only the label shown changes.
 * Categories the user created or renamed are shown exactly as saved.
 */
const MS_LABELS: Record<string, string> = {
  "food & drinks": "Makanan & Minuman",
  groceries: "Barang Dapur",
  transport: "Pengangkutan",
  bills: "Bil",
  shopping: "Membeli-belah",
  entertainment: "Hiburan",
  healthcare: "Kesihatan",
  education: "Pendidikan",
  travel: "Perjalanan",
  family: "Keluarga",
  other: "Lain-lain",
  supplies: "Bekalan",
  "inventory purchases": "Pembelian Stok",
  packaging: "Pembungkusan",
  shipping: "Penghantaran",
  marketing: "Pemasaran",
  advertising: "Pengiklanan",
  "staff expenses": "Perbelanjaan Staf",
  software: "Perisian",
  rent: "Sewa",
  utilities: "Utiliti",
  "professional fees": "Yuran Profesional",
};

export function categoryLabel(name: string, lang: Lang): string {
  if (lang !== "ms") return name;
  return MS_LABELS[name.trim().toLowerCase()] ?? name;
}
