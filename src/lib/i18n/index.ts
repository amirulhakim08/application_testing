import { en, type MessageKey } from "./en";
import { ms } from "./ms";

export type Lang = "en" | "ms";
export type { MessageKey };
export const LANG_COOKIE = "kg_lang";

const dictionaries: Record<Lang, Record<MessageKey, string>> = { en, ms };

export function normalizeLang(v: string | undefined | null): Lang {
  return v === "en" ? "en" : "ms";
}

export type TFunction = (key: MessageKey, vars?: Record<string, string | number>) => string;

export function makeT(lang: Lang): TFunction {
  const dict = dictionaries[lang];
  return (key, vars) => {
    let s = dict[key] ?? en[key] ?? key;
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
    return s;
  };
}
