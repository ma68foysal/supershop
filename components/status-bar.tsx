"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { closeDay, openDay } from "@/app/actions";
import { toAsciiDigits } from "@/lib/format";
import type { BusinessDay, Settings } from "@/lib/types";
import Assistant from "./assistant";
import { Spinner, useReportBusy } from "./busy";
import { useI18n } from "./i18n";
import Sheet from "./sheet";
import { useToast } from "./toast";

export default function StatusBar({
  settings,
  openDay: day,
  todayTotal,
  todayCount,
}: {
  settings: Settings;
  openDay: BusinessDay | null;
  todayTotal: number;
  todayCount: number;
}) {
  const { t, f } = useI18n();
  const [closing, setClosing] = useState(false);
  const [cash, setCash] = useState("");
  const [pending, start] = useTransition();
  useReportBusy(pending);
  const toast = useToast();
  const isOpen = Boolean(day);

  const run = (fn: () => Promise<{ error?: string; message?: string }>) =>
    start(async () => {
      const r = await fn();
      if (r.error) toast(r.error, true);
      else {
        toast(r.message ?? "");
        setClosing(false);
        setCash("");
      }
    });

  return (
    <header className={"status" + (isOpen ? "" : " closed")}>
      <div className="status-top">
        <div className="shop-name">{settings.shop_name}</div>
        <div className="status-icons">
          <Assistant />
          <Link href="/settings" className="icon-btn" aria-label={t.settingsAria}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
          </svg>
          </Link>
        </div>
      </div>
      <div className="status-line">
        <div className="status-text">
          <span className="dot" />
          {isOpen ? (
            <>
              <b>{t.open}</b> {t.openSince(f.time(day!.opened_at, settings.timezone))}
              <br />
              {settings.auto_close ? t.closesAutoAt(f.clock(settings.close_time)) : t.closeWhenDone}
            </>
          ) : (
            <>
              <b>{t.closed}</b>
              <br />
              {settings.auto_open ? t.opensAutoAt(f.clock(settings.open_time)) : t.openToStart}
            </>
          )}
        </div>
        <button className="pill" disabled={pending} onClick={() => (isOpen ? setClosing(true) : run(openDay))}>
          {pending && !closing ? (
            <>
              <Spinner />
              {isOpen ? t.closing : t.opening}
            </>
          ) : isOpen ? (
            t.closeShop
          ) : (
            t.openShop
          )}
        </button>
      </div>

      {closing && (
        <Sheet title={t.closeTitle} onClose={() => setClosing(false)}>
          <p className="sub">{t.closeSummary(f.num(todayCount), f.money(todayTotal))}</p>
          <label className="field">
            <span>{t.countedCash}</span>
            <input
              inputMode="decimal"
              value={cash}
              onChange={(e) => setCash(toAsciiDigits(e.target.value).replace(/[^\d.]/g, ""))}
            />
          </label>
          <button
            className="primary"
            disabled={pending}
            onClick={() => run(() => closeDay(cash ? Number(cash) : null))}
          >
            {pending ? (
              <>
                <Spinner />
                {t.closingReport}
              </>
            ) : (
              t.closeAndReport
            )}
          </button>
          <button className="secondary" onClick={() => setClosing(false)}>
            {t.keepSelling}
          </button>
        </Sheet>
      )}
    </header>
  );
}
