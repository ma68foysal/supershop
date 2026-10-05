"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState, useTransition } from "react";
import { addSaleToDay, deleteDay, setCountedCash } from "@/app/actions";
import { Spinner, useReportBusy } from "@/components/busy";
import ConfirmDialog from "@/components/confirm-dialog";
import { useI18n } from "@/components/i18n";
import { useToast } from "@/components/toast";
import { toAsciiDigits } from "@/lib/format";
import type { ActionResult, BusinessDay } from "@/lib/types";

const digitsOnly = (v: string) => toAsciiDigits(v).replace(/[^\d.]/g, "");

/** Owner tools for one day: add a forgotten sale, fix the cash count, delete the day. */
export default function DayTools({ day, salesCount, total }: { day: BusinessDay; salesCount: number; total: number }) {
  const { t, f } = useI18n();
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<"sale" | "cash" | "delete" | null>(null);
  useReportBusy(pending);

  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [cash, setCash] = useState(day.counted_cash !== null ? String(Number(day.counted_cash)) : "");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const closeDelete = useCallback(() => setConfirmDelete(false), []);
  const closed = day.status === "closed";

  const run = (which: typeof busy, fn: () => Promise<ActionResult>, after?: () => void) =>
    start(async () => {
      setBusy(which);
      const r = await fn();
      if (r.error) toast(r.error, true);
      else {
        toast(r.message ?? "");
        after?.();
      }
    });

  const label = (which: typeof busy, text: string, doing: string) =>
    pending && busy === which ? (
      <>
        <Spinner />
        {doing}
      </>
    ) : (
      text
    );

  return (
    <section>
      <div className="section-head">
        <h3>{t.changeDay}</h3>
      </div>

      {closed && (
        <>
          <p className="sub">{t.missedSale}</p>
          <div className="two">
            <label className="field" style={{ marginTop: 6 }}>
              <span>{t.amountTk}</span>
              <input inputMode="decimal" value={amount} onChange={(e) => setAmount(digitsOnly(e.target.value))} />
            </label>
            <label className="field" style={{ marginTop: 6 }}>
              <span>{t.note}</span>
              <input value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
          </div>
          <div className="actions">
            <button
              className="btn-small"
              disabled={pending || !(Number(amount) > 0)}
              onClick={() =>
                run("sale", () => addSaleToDay(day.id, Number(amount), note), () => {
                  setAmount("");
                  setNote("");
                })
              }
            >
              {label("sale", t.addSaleBtn, t.saving)}
            </button>
          </div>

          <label className="field">
            <span>{t.countedCash}</span>
            <input inputMode="decimal" value={cash} onChange={(e) => setCash(digitsOnly(e.target.value))} />
          </label>
          <div className="actions">
            <button
              className="mini"
              disabled={pending}
              onClick={() => run("cash", () => setCountedCash(day.id, cash === "" ? null : Number(cash)))}
            >
              {label("cash", t.saveCash, t.saving)}
            </button>
          </div>
        </>
      )}

      <div className="actions" style={{ marginTop: 16 }}>
        <button className="mini danger" onClick={() => setConfirmDelete(true)}>
          {t.deleteDay}
        </button>
      </div>
      {confirmDelete && (
        <ConfirmDialog
          tone="danger"
          title={t.deleteDayTitle}
          body={t.deleteDayBody(f.num(salesCount))}
          subject={{ label: f.date(day.day_date), amount: f.money(total) }}
          confirmLabel={t.yesDelete}
          pendingLabel={t.deleting}
          pending={pending}
          onConfirm={() => run("delete", () => deleteDay(day.id), () => router.replace("/reports"))}
          onCancel={closeDelete}
        />
      )}
    </section>
  );
}
