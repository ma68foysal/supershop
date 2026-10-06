import Link from "next/link";
import { getDays, getSales, getShop, getStaffNames, totalsByDate } from "@/lib/data";
import { getI18n } from "@/lib/i18n-server";
import SalesList from "@/components/sales-list";

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
  const live = sales.filter((s) => !s.voided_at);
  const total = live.reduce((a, s) => a + Number(s.total), 0);
  const itemsCount = live.reduce((a, s) => a + s.sale_items.length, 0);

  const byDate = totalsByDate(days);
  const prevDate = [...byDate.keys()].filter((d) => d < day.day_date).sort().pop();
  const prevTotal = prevDate ? byDate.get(prevDate)! : null;

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
      <SalesList sales={sales} staff={staff} tz={settings.timezone} canChange={me.role === "owner" || Boolean(openDay)} />
    </main>
  );
}
