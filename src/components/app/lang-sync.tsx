"use client";
import { useEffect } from "react";
import { setLanguageCookie } from "@/app/actions/settings";

/** Aligns the language cookie with the saved preference (e.g. after logging in on a new device). */
export function LangSync({ lang }: { lang: "en" | "ms" }) {
  useEffect(() => {
    void setLanguageCookie(lang);
  }, [lang]);
  return null;
}
