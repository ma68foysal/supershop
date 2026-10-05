"use client";

import { useTransition } from "react";
import { setLanguage } from "@/app/actions";
import type { Lang } from "@/lib/format";
import { Spinner, useReportBusy } from "./busy";
import { useI18n } from "./i18n";

const OPTIONS: { value: Lang; label: string }[] = [
  { value: "bn", label: "বাংলা" },
  { value: "en", label: "English" },
];

export default function LanguageSwitch() {
  const { lang, t } = useI18n();
  const [pending, start] = useTransition();
  useReportBusy(pending);
  return (
    <div className="seg" role="group" aria-label={t.language} style={{ marginBottom: 0 }}>
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          lang={o.value}
          aria-pressed={lang === o.value}
          disabled={pending}
          onClick={() => lang !== o.value && start(() => setLanguage(o.value))}
        >
          {pending && lang !== o.value && <Spinner />}
          {o.label}
        </button>
      ))}
    </div>
  );
}
