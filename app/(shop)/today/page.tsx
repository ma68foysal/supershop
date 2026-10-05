import Link from "next/link";
import { getDays, getSales, getShop, getStaffNames, totalsByDate } from "@/lib/data";
import { getI18n } from "@/lib/i18n-server";
import VoidSale from "./void-sale";

export const metadata = { title: "Today · Dokan" };

export default async function TodayPage() {
  const [{ openDay, settings, me }, { t, f }, days] = await Promise.all([getShop(), getI18n(), getDays(10)]);
  // Show the open day, or the most recent closed one
  const day = openDay ?? days[0];

  if (!day)
    return (
      <main className="main">
        <h2 className="h2">{t.noSalesYet}</h2>
        <p className="sub" style={{ marginTop: 6 }}>
          {t.noSalesHint}
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
          {t.closedShowing(f.date(day.day_date))}{" "}
          <Link className="link" href="/reports">
            {t.seeAllReports}
          </Link>
        </p>
      )}
      <div className="ledger">
        <div className="ledger-label">{openDay ? t.soldTodaySoFar : t.soldOn(f.date(day.day_date))}</div>
        <div className="ledger-amount" style={{ fontSize: 64 }}>
          <span className="tk">৳</span>
          <span>{f.num(total)}</span>
        </div>
      </div>
      <div className="facts">
        <div className="fact">
          <span className="num">{f.num(live.length)}</span>
          <span>{t.salesWord}</span>
        </div>
        <div className="fact">
          <span className="num">{f.money(live.length ? Math.round(total / live.length) : 0)}</span>
          <span>{t.averageSale}</span>
        </div>
        <div className="fact">
          <span className="num">{f.num(itemsCount)}</span>
          <span>{t.itemsListed}</span>
        </div>
      </div>
      {prevTotal !== null && (
        <p style={{ marginTop: 12, fontSize: 15 }}>
          {t.prevClosedAt(f.date(prevDate!), f.money(prevTotal))}{" "}
          {total >= prevTotal ? (
            <span className="up">{t.ahead(f.money(total - prevTotal))}</span>
          ) : openDay ? (
            t.toGo(f.money(prevTotal - total))
          ) : (
            <span className="down">{t.lessThan(f.money(prevTotal - total))}</span>
          )}
        </p>
      )}

      <div className="section-head">
        <h3>{t.salesHeading}</h3>
        <span className="sub">{sales.length ? t.newestFirst : ""}</span>
      </div>
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
                  <div
                    className="row-price num"
                    style={{ textDecoration: s.voided_at ? "line-through" : undefined }}
                  >
                    {f.money(s.total)}
                  </div>
                </summary>
                <div className="sale-items">
                  {s.sale_items.map((i, n) => (
                    <div key={n}>
                      <span>
                        {i.name} × {f.qty(Number(i.qty), i.unit)}
                      </span>
                      <span>{f.money(i.line_total)}</span>
                    </div>
                  ))}
                  {s.discount > 0 && (
                    <div>
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
                  {!s.voided_at && me.role === "owner" && <VoidSale saleId={s.id} receiptNo={s.receipt_no} />}
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
    </main>
  );
}
