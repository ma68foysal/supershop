import { getI18n } from "@/lib/i18n-server";
import type { Sale, Staff } from "@/lib/types";
import SaleActions from "./sale-actions";

/** A day's sales, newest first. Tap one to see its items, and edit, void or delete it when allowed. */
export default async function SalesList({
  sales,
  staff,
  tz,
  canChange,
}: {
  sales: Sale[];
  staff: Staff[];
  tz: string;
  /** Owner always; staff only while this day is open */
  canChange: boolean;
}) {
  const { t, f } = await getI18n();
  const names = new Map(staff.map((s) => [s.id, s.name]));

  return (
    <ul className="rows">
      {[...sales].reverse().map((s) => {
        const itemNames = s.sale_items.map((i) => i.name);
        return (
          <li key={s.id} style={{ borderBottom: "1px solid var(--rule)" }}>
            <details className="sale">
              <summary className="row" style={{ borderBottom: 0, opacity: s.voided_at ? 0.55 : 1 }}>
                <div className="row-main">
                  <div className="row-name">
                    {s.kind === "quick"
                      ? s.note || t.totalOnly
                      : itemNames.slice(0, 2).join(", ") +
                        (itemNames.length > 2 ? ` ${t.moreItems(f.num(itemNames.length - 2))}` : "")}
                    {s.kind === "quick" && s.note && <span className="tag">{t.totalOnly}</span>}
                    {s.voided_at && <span className="tag void">{t.voided}</span>}
                  </div>
                  <div className="row-meta">
                    <b>#{f.digits(s.receipt_no)}</b> {f.time(s.created_at, tz)}
                    {s.created_by && names.get(s.created_by) ? `, ${names.get(s.created_by)}` : ""}
                  </div>
                </div>
                <div className="row-price num" style={{ textDecoration: s.voided_at ? "line-through" : undefined }}>
                  {f.money(s.total)}
                </div>
              </summary>
              <div className="sale-items">
                {s.sale_items.map((i) => (
                  <div className="line" key={i.id}>
                    <span>
                      {i.name} × {f.qty(Number(i.qty), i.unit)}
                    </span>
                    <span>{f.money(i.line_total)}</span>
                  </div>
                ))}
                {s.discount > 0 && (
                  <div className="line">
                    <span>{t.discount}</span>
                    <span>−{f.money(s.discount)}</span>
                  </div>
                )}
                {s.voided_at && (
                  <p>
                    {t.voided}
                    {s.void_reason ? `: ${s.void_reason}` : ""}
                  </p>
                )}
                {canChange && <SaleActions sale={s} />}
              </div>
            </details>
          </li>
        );
      })}
      {!sales.length && (
        <li className="row">
          <div className="row-main">
            <div className="row-name">{t.noSalesYet}</div>
            <div className="row-meta">{t.salesShowHere}</div>
          </div>
        </li>
      )}
    </ul>
  );
}
