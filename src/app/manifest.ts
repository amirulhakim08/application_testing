import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "KiraGo — Expense Tracker",
    short_name: "KiraGo",
    description: "Snap it. Say it. Track it.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f6f5f1",
    theme_color: "#1f5c43",
    categories: ["finance", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml" },
    ],
    shortcuts: [
      { name: "Scan receipt", url: "/add/scan" },
      { name: "Voice expense", url: "/add/voice" },
      { name: "Manual expense", url: "/add/manual" },
    ],
  };
}
