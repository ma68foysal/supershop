"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { closeDay, openDay } from "@/app/actions";
import { clock12, money, timeOf } from "@/lib/format";
import type { BusinessDay, Settings } from "@/lib/types";
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
  const [closing, setClosing] = useState(false);
  const [cash, setCash] = useState("");
  const [pending, start] = useTransition();
  const toast = useToast();
  const isOpen = Boolean(day);

  const run = (fn: () => Promise<{ error?: string; message?: string }>) =>
    start(async () => {
      const r = await fn();
      if (r.error) toast(r.error, true);
      else {
        toast(r.message ?? "Done");
        setClosing(false);
        setCash("");
      }
    });

  return (
    <header className={"status" + (isOpen ? "" : " closed")}>
      <div className="status-top">
        <div className="shop-name">{settings.shop_name}</div>
        <Link href="/settings" className="icon-btn" aria-label="Settings and shop hours">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
          </svg>
        </Link>
      </div>
      <div className="status-line">
        <div className="status-text">
          <span className="dot" />
          {isOpen ? (
            <>
              <b>Open</b> since {timeOf(day!.opened_at, settings.timezone)}
              <br />
              {settings.auto_close
                ? `Closes automatically at ${clock12(settings.close_time)}`
                : "Close the shop when you're done"}
            </>
          ) : (
            <>
              <b>Closed</b>
              <br />
              {settings.auto_open
                ? `Opens automatically at ${clock12(settings.open_time)}`
                : "Open the shop to start selling"}
            </>
          )}
        </div>
        <button
          className="pill"
          disabled={pending}
          onClick={() => (isOpen ? setClosing(true) : run(openDay))}
        >
          {isOpen ? "Close shop" : pending ? "Opening…" : "Open shop"}
        </button>
      </div>

      {closing && (
        <Sheet title="Close the shop for today?" onClose={() => setClosing(false)}>
          <p className="sub">
            {todayCount} sales, {money(todayTotal)} in total. The day&apos;s PDF report is ready as soon as you close.
          </p>
          <label className="field">
            <span>Cash counted in the drawer (optional)</span>
            <input inputMode="decimal" value={cash} onChange={(e) => setCash(e.target.value.replace(/[^\d.]/g, ""))} />
          </label>
          <button
            className="primary"
            disabled={pending}
            onClick={() => run(() => closeDay(cash ? Number(cash) : null))}
          >
            {pending ? "Closing…" : "Close shop and make report"}
          </button>
          <button className="secondary" onClick={() => setClosing(false)}>
            Keep selling
          </button>
        </Sheet>
      )}
    </header>
  );
}
