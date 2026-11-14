"use client";

import * as React from "react";
import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";
import { makeT, type Lang, type TFunction } from "@/lib/i18n";

const I18nContext = React.createContext<{ lang: Lang; t: TFunction }>({ lang: "en", t: makeT("en") });

export function useI18n() {
  return React.useContext(I18nContext);
}

export function Providers({ lang, children }: { lang: Lang; children: React.ReactNode }) {
  const value = React.useMemo(() => ({ lang, t: makeT(lang) }), [lang]);
  React.useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <I18nContext.Provider value={value}>
        {children}
        <Toaster position="top-center" richColors closeButton toastOptions={{ className: "!rounded-2xl" }} />
      </I18nContext.Provider>
    </ThemeProvider>
  );
}
