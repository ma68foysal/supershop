import "server-only";
import { cookies } from "next/headers";
import { formatters } from "./format";
import { DICTS, LANG_COOKIE, parseLang } from "./i18n";

/** Language for this request: the phone's choice, Bangla by default. */
export async function getLang() {
  return parseLang((await cookies()).get(LANG_COOKIE)?.value);
}

export async function getI18n() {
  const lang = await getLang();
  return { lang, t: DICTS[lang], f: formatters(lang) };
}
