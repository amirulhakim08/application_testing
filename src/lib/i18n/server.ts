import "server-only";
import { cookies } from "next/headers";
import { LANG_COOKIE, makeT, normalizeLang } from "./index";

export async function getI18n() {
  const lang = normalizeLang((await cookies()).get(LANG_COOKIE)?.value);
  return { lang, t: makeT(lang) };
}
