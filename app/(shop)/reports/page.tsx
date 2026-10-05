import { getDays, getShop, totalsByDate } from "@/lib/data";
import { pctChange } from "@/lib/format";
import { getI18n } from "@/lib/i18n-server";
import ReportActions from "./report-actions";

export const metadata = { title: "Reports · Dokan" };

export default async function ReportsPage() {
  const [{ settings }, { t, f }, days] = await Promise.all([getShop(), getI18n(), getDays(90)]);
  const byDate = totalsByDate(days);
  const dates = [...byDate.keys()].sort(); // oldest → newest
  const week = dates.slice(-7);
  const max = Math.max(1, ...week.map((d) => byDate.get(d)!));
  const today = days.find((d) => d.status === "open")?.day_date;
  const tz = settings.timezone;

  return (
    <main className="main">
      <h2 className="h2">{t.reportsTitle}</h2>
      <p className="sub">
        {t.reportsSub} {t.pdfInEnglish}
      </p>

      {week.length > 1 && (
        <>
          <div className="bars" aria-hidden="true">
            {week.map((d) => (
              <div
                key={d}
                className={"bar" + (d === today ? " today" : "")}
                style={{ height: `${(byDate.get(d)! / max) * 100}%` }}
                title={`${f.date(d)} ${f.money(byDate.get(d)!)}`}
              />
            ))}
          </div>
          <div className="bar-labels" aria-hidden="true">
            {week.map((d) => (
              <span key={d}>{d === today ? t.today : f.weekday(d)}</span>
            ))}
          </div>
        </>
      )}

      <ul className="rows" style={{ marginTop: 18 }}>
        {days.map((d) => {
          const prev = dates.filter((x) => x < d.day_date).pop();
          const pct = prev ? pctChange(byDate.get(d.day_date)!, byDate.get(prev)!) : null;
          const open = d.status === "open";
          return (
            <li className="row" key={d.id} style={{ alignItems: "flex-start" }}>
              <div className="row-main">
                <div className="row-name">
                  {f.date(d.day_date)}
                  {open && <span className="tag">{t.openNow}</span>}
                </div>
                <div className="row-meta">
                  {t.salesCount(f.num(d.sales_count))}, {f.time(d.opened_at, tz)}–
                  {d.closed_at ? f.time(d.closed_at, tz) : t.now}
                  {pct !== null && !open && (
                    <>
                      ,{" "}
                      <span className={pct >= 0 ? "up" : "down"}>
                        {pct >= 0 ? "▲" : "▼"} {f.num(Math.abs(pct))}% {t.vs(f.date(prev!))}
                      </span>
                    </>
                  )}
                </div>
                <ReportActions dayId={d.id} fileName={`${slug(settings.shop_name)}-${d.day_date}.pdf`} />
              </div>
              <div className="row-price num">{f.money(d.total)}</div>
            </li>
          );
        })}
        {!days.length && (
          <li className="row">
            <div className="row-main">
              <div className="row-name">{t.noReports}</div>
              <div className="row-meta">{t.noReportsHint}</div>
            </div>
          </li>
        )}
      </ul>
    </main>
  );
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "shop";
