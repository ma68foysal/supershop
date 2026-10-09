import Link from "next/link";
import { getShop } from "@/lib/data";
import { pctChange } from "@/lib/format";
import { getI18n } from "@/lib/i18n-server";
import { getMonthReport, isMonth, monthBounds, shiftMonth, todayIn } from "@/lib/month";
import ReportActions from "../report-actions";

export const metadata = { title: "Monthly report · Dokan" };

export default async function MonthPage(props: PageProps<"/reports/month">) {
  const { m } = await props.searchParams;
  const [{ supabase, settings }, { t, f }] = await Promise.all([getShop(), getI18n()]);
  const thisMonth = todayIn(settings.timezone).slice(0, 7);
  const month = isMonth(m) && m <= thisMonth ? m : thisMonth;
  const r = await getMonthReport(supabase, month, settings.timezone);
  const { cur, prev } = r;

  const pct = pctChange(cur.total, prev.total);
  const open = cur.days.filter((d) => d.sales > 0 || d.total > 0);
  const daysOpen = cur.days.length;
  const best = open.length ? open.reduce((a, b) => (b.total > a.total ? b : a)) : null;
  const worst = open.length > 1 ? open.reduce((a, b) => (b.total < a.total ? b : a)) : null;

  // One bar per calendar day of the month
  const { days: inMonth } = monthBounds(month);
  const byDate = new Map(cur.days.map((d) => [d.date, d.total]));
  const bars = Array.from({ length: inMonth }, (_, i) => {
    const date = `${month}-${String(i + 1).padStart(2, "0")}`;
    return { day: i + 1, date, total: byDate.get(date) ?? 0 };
  });
  const max = Math.max(1, ...bars.map((b) => b.total));
  const fileName = `${settings.shop_name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "shop"}-${month}.pdf`;
  const row = (label: React.ReactNode, value: React.ReactNode) => (
    <li className="row">
      <div className="row-main">{label}</div>
      <div className="row-price num">{value}</div>
    </li>
  );

  return (
    <main className="main">
      <Link href="/reports" className="link back-link">
        {t.allReports}
      </Link>
      <div className="month-nav">
        <Link className="mini" href={`/reports/month?m=${shiftMonth(month, -1)}`} aria-label={t.prevMonth}>
          ‹
        </Link>
        <h2 className="h2">{f.month(month)}</h2>
        {month < thisMonth ? (
          <Link className="mini" href={`/reports/month?m=${shiftMonth(month, 1)}`} aria-label={t.nextMonth}>
            ›
          </Link>
        ) : (
          <span className="mini" aria-hidden="true" style={{ visibility: "hidden" }}>
            ›
          </span>
        )}
      </div>

      <div className="ledger" style={{ marginTop: 12 }}>
        <div className="ledger-label">{t.monthTotal(f.month(month))}</div>
        <div className="ledger-amount" style={{ fontSize: 64 }}>
          <span className="tk">৳</span>
          <span>{f.num(cur.total)}</span>
        </div>
      </div>
      {pct !== null && (
        <p style={{ marginTop: 10, fontSize: 15 }}>
          <span className={pct >= 0 ? "up" : "down"}>
            {pct >= 0 ? "▲" : "▼"} {f.num(Math.abs(pct))}%
          </span>{" "}
          {r.sameDays ? t.vsSameDaysLastMonth(f.money(prev.total)) : t.vsLastMonth(f.money(prev.total))}
        </p>
      )}
      <ReportActions pdfUrl={`/api/reports/month/${month}/pdf`} fileName={fileName} />

      <div className="facts">
        <div className="fact">
          <span className="num">{f.num(daysOpen)}</span>
          <span>{t.daysOpen}</span>
        </div>
        <div className="fact">
          <span className="num">{f.money(daysOpen ? Math.round(cur.total / daysOpen) : 0)}</span>
          <span>{t.perDay}</span>
        </div>
        <div className="fact">
          <span className="num">{f.num(cur.sales)}</span>
          <span>{t.salesWord}</span>
        </div>
      </div>

      {!cur.sales ? (
        <p className="notice" style={{ marginTop: 16 }}>
          {t.noSalesMonth}
        </p>
      ) : (
        <>
          <ul className="rows" style={{ marginTop: 14 }}>
            {best && row(<>{t.bestDay}: <b>{f.date(best.date)}</b></>, f.money(best.total))}
            {worst && row(<>{t.slowestDay}: <b>{f.date(worst.date)}</b></>, f.money(worst.total))}
          </ul>

          <div className="section-head">
            <h3>{t.dayByDay}</h3>
          </div>
          <div className="bars month" aria-hidden="true">
            {bars.map((b) => (
              <div
                key={b.day}
                className="bar"
                style={{ height: `${(b.total / max) * 100}%` }}
                title={`${f.date(b.date)} ${f.money(b.total)}`}
              />
            ))}
          </div>
          <div className="bar-labels month" aria-hidden="true">
            {bars.map((b) => (
              <span key={b.day}>{b.day === 1 || b.day % 5 === 0 ? f.digits(b.day) : ""}</span>
            ))}
          </div>

          <div className="section-head">
            <h3>{t.profit}</h3>
          </div>
          {r.profit !== null ? (
            <>
              <div className="profit-line">
                <span className={"num " + (r.profit >= 0 ? "up" : "down")}>{f.money(r.profit)}</span>
                {r.margin !== null && <span className="tag">{t.margin(f.num(r.margin))}</span>}
              </div>
              <ul className="rows" style={{ marginTop: 8 }}>
                {row(t.costedSales, f.money(cur.costed_revenue))}
                {row(t.buyingCost, f.money(cur.cost))}
              </ul>
              <p className="sub" style={{ marginTop: 6 }}>
                {t.profitNote(f.num(r.costCoverage))}
              </p>
            </>
          ) : (
            <p className="notice">{t.noCostPrices}</p>
          )}

          <div className="section-head">
            <h3>{t.topItems}</h3>
          </div>
          <ul className="rows">
            {cur.top_items.map((it) => (
              <li className="row" key={it.name + it.unit}>
                <div className="row-main">
                  <div className="row-name">{it.name}</div>
                  <div className="row-meta">{f.qty(it.qty, it.unit)}</div>
                </div>
                <div className="row-price num">{f.money(it.amount)}</div>
              </li>
            ))}
            {!cur.top_items.length && (
              <li className="row">
                <div className="row-main">
                  <div className="row-meta">{t.onlyTotals}</div>
                </div>
              </li>
            )}
          </ul>

          <div className="section-head">
            <h3>{t.saleMix}</h3>
          </div>
          <ul className="rows">
            {row(t.itemByItem, f.money(cur.items_total))}
            {row(t.totalOnly, f.money(cur.quick_total))}
            {row(t.discountsGiven, f.money(cur.discount))}
            {row(t.voidedSales, f.num(cur.voids))}
          </ul>
        </>
      )}
    </main>
  );
}
