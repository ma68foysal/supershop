"use client";

import { createContext, useContext, useMemo } from "react";
import { formatters, type Lang } from "@/lib/format";
import { DEFAULT_LANG, DICTS } from "@/lib/i18n";

const Ctx = createContext<Lang>(DEFAULT_LANG);

export function I18nProvider({ lang, children }: { lang: Lang; children: React.ReactNode }) {
  return <Ctx.Provider value={lang}>{children}</Ctx.Provider>;
}

/** Text (t) and number/date formatters (f) in the phone's language. */
export function useI18n() {
  const lang = useContext(Ctx);
  return useMemo(() => ({ lang, t: DICTS[lang], f: formatters(lang) }), [lang]);
}
