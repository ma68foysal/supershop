"use client";

import type { Dict } from "@/lib/i18n";
import { useI18n } from "./i18n";

type LoaderLabel = "loadingProducts" | "loadingToday" | "loadingReports" | "loadingSettings";

/** Screen placeholder while a tab loads: a pen writes across the ledger and rows fill in. */
export default function LedgerLoader({ label }: { label: LoaderLabel & keyof Dict }) {
  const { t } = useI18n();
  return (
    <main className="main loader" role="status" aria-live="polite">
      <div className="ledger">
        <div className="ledger-label">{t[label]}…</div>
        <svg className="ink-stroke" viewBox="0 0 240 48" aria-hidden="true">
          <path d="M4 34 C 18 8, 32 8, 40 28 S 62 44, 76 20 S 100 4, 114 26 S 138 42, 152 18 S 178 6, 190 26 S 218 36, 236 22" />
        </svg>
      </div>
      <ul className="loader-rows" aria-hidden="true">
        {[72, 48, 64, 38, 56].map((w, i) => (
          <li key={i}>
            <span style={{ width: `${w}%`, animationDelay: `${i * 0.12}s` }} />
            <span className="r" style={{ animationDelay: `${i * 0.12 + 0.06}s` }} />
          </li>
        ))}
      </ul>
    </main>
  );
}
