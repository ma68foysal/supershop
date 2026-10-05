"use client";

import { useCallback, useState, useTransition } from "react";
import { deleteSale, updateSale, voidSale } from "@/app/actions";
import { qtyStep, toAsciiDigits } from "@/lib/format";
import type { ActionResult, Sale } from "@/lib/types";
import { Spinner, useReportBusy } from "./busy";
import ConfirmDialog from "./confirm-dialog";
import { useI18n } from "./i18n";
import Sheet from "./sheet";
import { useToast } from "./toast";

type Mode = null | "void" | "delete" | "edit";

/** Owner tools under a sale: edit, void (reason optional) and delete for good. */
export default function SaleActions({ sale }: { sale: Sale }) {
  const { t, f } = useI18n();
  const [mode, setMode] = useState<Mode>(null);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  useReportBusy(pending);
  const toast = useToast();
  const no = f.digits(sale.receipt_no);
  const close = useCallback(() => setMode(null), []);
  const subject = { label: t.saleLabel(no), amount: f.money(sale.total) };

  const run = (fn: () => Promise<ActionResult>) =>
    start(async () => {
      const r = await fn();
      if (r.error) toast(r.error, true);
      else {
        toast(r.message ?? "");
        setMode(null);
        setReason("");
      }
    });

  return (
    <>
      <div className="actions">
        {!sale.voided_at && (
          <button className="mini" onClick={() => setMode("edit")}>
            {t.editBtn}
          </button>
        )}
        {!sale.voided_at && (
          <button className="mini" onClick={() => setMode("void")}>
            {t.voidShort}
          </button>
        )}
        <button className="mini danger" onClick={() => setMode("delete")}>
          {t.deleteBtn}
        </button>
      </div>

      {mode === "void" && (
        <ConfirmDialog
          tone="warn"
          title={t.voidTitle}
          body={t.voidBody}
          subject={subject}
          confirmLabel={t.yesVoid}
          pendingLabel={t.voiding}
          pending={pending}
          onConfirm={() => run(() => voidSale(sale.id, reason))}
          onCancel={close}
        >
          <input
            className="input"
            placeholder={t.reasonOptional}
            aria-label={t.voidReasonAria}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </ConfirmDialog>
      )}

      {mode === "delete" && (
        <ConfirmDialog
          tone="danger"
          title={t.deleteTitle}
          body={t.deleteBody}
          subject={subject}
          confirmLabel={t.yesDelete}
          pendingLabel={t.deleting}
          pending={pending}
          onConfirm={() => run(() => deleteSale(sale.id))}
          onCancel={close}
        />
      )}

      {mode === "edit" && <EditSale sale={sale} onClose={() => setMode(null)} />}
    </>
  );
}

function EditSale({ sale, onClose }: { sale: Sale; onClose: () => void }) {
  const { t, f } = useI18n();
  const [amount, setAmount] = useState(String(Number(sale.total)));
  const [note, setNote] = useState(sale.note ?? "");
  const [lines, setLines] = useState(sale.sale_items.map((i) => ({ ...i, qty: Number(i.qty) })));
  const [discount, setDiscount] = useState(Number(sale.discount) ? String(Number(sale.discount)) : "");
  const [pending, start] = useTransition();
  useReportBusy(pending);
  const toast = useToast();

  const quick = sale.kind === "quick";
  const sub = lines.reduce((a, l) => a + Math.round(Number(l.unit_price) * l.qty * 100) / 100, 0);
  const disc = Math.min(Number(discount || 0), sub);
  const setQty = (id: string, qty: number) =>
    setLines((ls) => ls.map((l) => (l.id === id ? { ...l, qty: Math.round(qty * 1000) / 1000 } : l)));
  const valid = quick ? Number(amount) > 0 : lines.length > 0 && lines.every((l) => l.qty > 0);

  const save = () =>
    start(async () => {
      const r = await updateSale(
        sale.id,
        quick
          ? { total: Number(amount), note }
          : { items: lines.map((l) => ({ id: l.id, qty: l.qty })), discount: disc, note },
      );
      if (r.error) toast(r.error, true);
      else {
        toast(r.message ?? "");
        onClose();
      }
    });

  return (
    <Sheet title={t.editSale(f.digits(sale.receipt_no))} onClose={onClose}>
      {quick ? (
        <label className="field">
          <span>{t.amountTk}</span>
          <input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(toAsciiDigits(e.target.value).replace(/[^\d.]/g, ""))}
          />
        </label>
      ) : (
        <>
          <ul className="rows" style={{ marginTop: 10 }}>
            {lines.map((l) => (
              <li className="row" key={l.id}>
                <div className="row-main">
                  <div className="row-name">{l.name}</div>
                  <div className="row-meta">
                    {f.money(l.unit_price)} {t.perUnit(f.unit(l.unit))}
                  </div>
                </div>
                <div className="stepper">
                  <button
                    aria-label={t.less(l.name)}
                    onClick={() => l.qty - qtyStep(l.unit) > 0 && setQty(l.id, l.qty - qtyStep(l.unit))}
                  >
                    −
                  </button>
                  <input
                    inputMode="decimal"
                    aria-label={t.qtyOf(l.name, f.unit(l.unit))}
                    value={l.qty}
                    onChange={(e) => {
                      const v = toAsciiDigits(e.target.value).replace(/[^\d.]/g, "");
                      setQty(l.id, v === "" ? 0 : Number(v));
                    }}
                  />
                  <button aria-label={t.more(l.name)} onClick={() => setQty(l.id, l.qty + qtyStep(l.unit))}>
                    +
                  </button>
                </div>
                <button
                  className="remove-line"
                  aria-label={t.removeLine(l.name)}
                  onClick={() => setLines((ls) => ls.filter((x) => x.id !== l.id))}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
          <p className="sub" style={{ marginTop: 6 }}>
            {t.pricesAsSold}
          </p>
          <label className="field">
            <span>{t.discountTk}</span>
            <input
              inputMode="decimal"
              value={discount}
              placeholder={f.digits(0)}
              onChange={(e) => setDiscount(toAsciiDigits(e.target.value).replace(/[^\d.]/g, ""))}
            />
          </label>
          <div className="totals">
            <div>
              <span>{t.subtotal}</span>
              <span className="num">{f.money(sub)}</span>
            </div>
            {disc > 0 && (
              <div>
                <span>{t.discount}</span>
                <span className="num">−{f.money(disc)}</span>
              </div>
            )}
            <div className="grand">
              <span>{t.total}</span>
              <span className="num">{f.money(sub - disc)}</span>
            </div>
          </div>
        </>
      )}
      <label className="field">
        <span>{t.note}</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <button className="primary" disabled={pending || !valid} onClick={save}>
        {pending ? (
          <>
            <Spinner />
            {t.saving}
          </>
        ) : (
          t.saveChanges
        )}
      </button>
    </Sheet>
  );
}
