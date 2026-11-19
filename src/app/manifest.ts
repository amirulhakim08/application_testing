import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "BukuTigaLima — Dulu Buku, Sekarang Digital",
    short_name: "BukuTigaLima",
    description: "Sebut harga, invois, resit dan perbelanjaan harian dalam satu aplikasi.",
    lang: "ms",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#faf8f4",
    theme_color: "#17324d",
    categories: ["business", "finance", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml" },
    ],
    shortcuts: [
      { name: "Scan Resit", url: "/add/scan" },
      { name: "Rekod Suara", url: "/add/voice" },
      { name: "Tambah Perbelanjaan", url: "/add/manual" },
    ],
  };
}
