import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import "./globals.css";
import { Providers } from "@/components/providers";
import { LANG_COOKIE, normalizeLang } from "@/lib/i18n";

export const metadata: Metadata = {
  title: { default: "BukuTigaLima — Dulu Buku, Sekarang Digital", template: "%s · BukuTigaLima" },
  description:
    "Jana sebut harga, invois dan resit. Rekod perbelanjaan harian dengan mudah — semuanya dalam satu aplikasi untuk peniaga kecil Malaysia.",
  applicationName: "BukuTigaLima",
  appleWebApp: { capable: true, title: "BukuTigaLima", statusBarStyle: "default" },
  icons: { icon: "/icons/icon.svg", apple: "/icons/apple-touch-icon.png" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf8f4" },
    { media: "(prefers-color-scheme: dark)", color: "#0f151c" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const lang = normalizeLang((await cookies()).get(LANG_COOKIE)?.value);
  return (
    <html lang={lang === "ms" ? "ms" : "en"} suppressHydrationWarning>
      <body>
        <Providers lang={lang}>{children}</Providers>
      </body>
    </html>
  );
}
