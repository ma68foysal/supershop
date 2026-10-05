import Link from "next/link";
import { getDays, getSales, getShop, getStaffNames, totalsByDate } from "@/lib/data";
import { money, qtyLabel, shortDate, timeOf } from "@/lib/format";
import VoidSale from "./void-sale";

export const metadata = { title: "Today · Dokan" };

export default async function TodayPage() {
  const { openDay, settings, me } = await getShop();
  const days = await getDays(10);
  // Show the open day, or the most recent closed one
  const day = openDay ?? days[0];

  if (!day)
    return (
      <main className="main">
        <h2 className="h2">No sales yet</h2>
        <p className="sub" style={{ marginTop: 6 }}>
          Tap <b>Open shop</b> at the top, then record sales on the Sell tab. They show up here.
        </p>
      </main>
    );

  const [sales, staff] = await Promise.all([getSales(day.id), getStaffNames()]);
  const names = new Map(staff.map((s) => [s.id, s.name]));
  const live = sales.filter((s) => !s.voided_at);
  const total = live.reduce((a, s) => a + Number(s.total), 0);
  const itemsCount = live.reduce((a, s) => a + s.sale_items.length, 0);

  const byDate = totalsByDate(days);
  const prevDate = [...byDate.keys()].filter((d) => d < day.day_date).sort().pop();
  const prevTotal = prevDate ? byDate.get(prevDate)! : null;
  const tz = settings.timezone;

  return (
    <main className="main">
      {!openDay && (
        <p className="notice" style={{ marginBottom: 14 }}>
          The shop is closed. This is {shortDate(day.day_date)}.{" "}
          <Link className="link" href="/reports">
            See all reports
          </Link>
        </p>
      )}
      <div className="ledger">
        <div className="ledger-label">{openDay ? "Sold today so far" : `Sold on ${shortDate(day.day_date)}`}</div>
        <div className="ledger-amount" style={{ fontSize: 64 }}>
          <span className="tk">৳</span>
          <span>{total.toLocaleString("en-IN")}</span>
        </div>
      </div>
      <div className="facts">
        <div className="fact">
          <span className="num">{live.length}</span>
          <span>sales</span>
        </div>
        <div className="fact">
          <span className="num">{money(live.length ? Math.round(total / live.length) : 0)}</span>
          <span>average sale</span>
        </div>
        <div className="fact">
          <span className="num">{itemsCount}</span>
          <span>items listed</span>
        </div>
      </div>
      {prevTotal !== null && (
        <p style={{ marginTop: 12, fontSize: 15 }}>
          {shortDate(prevDate!)} closed at <b>{money(prevTotal)}</b>.{" "}
          {total >= prevTotal ? (
            <span className="up">{money(total - prevTotal)} ahead.</span>
          ) : openDay ? (
            <>{money(prevTotal - total)} to go to match it.</>
          ) : (
            <span className="down">{money(prevTotal - total)} less.</span>
          )}
        </p>
      )}

      <div className="section-head">
        <h3>Sales</h3>
        <span className="sub">{sales.length ? "Newest first, tap to see items" : ""}</span>
      </div>
      <ul className="rows">
        {[...sales].reverse().map((s) => (
          <li key={s.id} style={{ borderBottom: "1px solid var(--rule)" }}>
            <details className="sale">
              <summary className="row" style={{ borderBottom: 0, opacity: s.voided_at ? 0.55 : 1 }}>
                <div className="row-main">
                  <div className="row-name">
                    {s.kind === "quick"
                      ? s.note || "Total only"
                      : s.sale_items.map((i) => i.name).slice(0, 2).join(", ") +
                        (s.sale_items.length > 2 ? ` +${s.sale_items.length - 2} more` : "")}
                    {s.kind === "quick" && s.note && <span className="tag">Total only</span>}
                    {s.voided_at && <span className="tag void">Voided</span>}
                  </div>
                  <div className="row-meta">
                    <b>#{s.receipt_no}</b> {timeOf(s.created_at, tz)}
                    {s.created_by && names.get(s.created_by) ? `, ${names.get(s.created_by)}` : ""}
                  </div>
                </div>
                <div className="row-price num" style={{ textDecoration: s.voided_at ? "line-through" : undefined }}>
                  {money(s.total)}
                </div>
              </summary>
              <div className="sale-items">
                {s.sale_items.map((i, n) => (
                  <div key={n}>
                    <span>
                      {i.name} × {qtyLabel(i.qty, i.unit)}
                    </span>
                    <span>{money(i.line_total)}</span>
                  </div>
                ))}
                {s.discount > 0 && (
                  <div>
                    <span>Discount</span>
                    <span>−{money(s.discount)}</span>
                  </div>
                )}
                {s.voided_at && <p>Voided{s.void_reason ? `: ${s.void_reason}` : ""}</p>}
                {!s.voided_at && me.role === "owner" && <VoidSale saleId={s.id} receiptNo={s.receipt_no} />}
              </div>
            </details>
          </li>
        ))}
        {!sales.length && (
          <li className="row">
            <div className="row-main">
              <div className="row-name">No sales yet</div>
              <div className="row-meta">Sales you record on the Sell tab show up here.</div>
            </div>
          </li>
        )}
      </ul>
    </main>
  );
}
