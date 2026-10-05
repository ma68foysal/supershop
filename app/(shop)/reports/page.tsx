import { getDays, getShop, totalsByDate } from "@/lib/data";
import { money, pctChange, shortDate, timeOf } from "@/lib/format";
import ReportActions from "./report-actions";

export const metadata = { title: "Reports · Dokan" };

export default async function ReportsPage() {
  const [{ settings }, days] = await Promise.all([getShop(), getDays(90)]);
  const byDate = totalsByDate(days);
  const dates = [...byDate.keys()].sort(); // oldest → newest
  const week = dates.slice(-7);
  const max = Math.max(1, ...week.map((d) => byDate.get(d)!));
  const today = days.find((d) => d.status === "open")?.day_date;

  return (
    <main className="main">
      <h2 className="h2">Daily reports</h2>
      <p className="sub">A PDF report is ready for every day the shop was open.</p>

      {week.length > 1 && (
        <>
          <div className="bars" aria-hidden="true">
            {week.map((d) => (
              <div
                key={d}
                className={"bar" + (d === today ? " today" : "")}
                style={{ height: `${(byDate.get(d)! / max) * 100}%` }}
                title={`${shortDate(d)} ${money(byDate.get(d)!)}`}
              />
            ))}
          </div>
          <div className="bar-labels" aria-hidden="true">
            {week.map((d) => (
              <span key={d}>{d === today ? "Today" : shortDate(d).split(" ")[0]}</span>
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
                  {shortDate(d.day_date)}
                  {open && <span className="tag">Open now</span>}
                </div>
                <div className="row-meta">
                  {d.sales_count} sales, {timeOf(d.opened_at, settings.timezone)}–
                  {d.closed_at ? timeOf(d.closed_at, settings.timezone) : "now"}
                  {pct !== null && !open && (
                    <>
                      ,{" "}
                      <span className={pct >= 0 ? "up" : "down"}>
                        {pct >= 0 ? "▲" : "▼"} {Math.abs(pct)}% vs {shortDate(prev!)}
                      </span>
                    </>
                  )}
                </div>
                <ReportActions dayId={d.id} fileName={`${slug(settings.shop_name)}-${d.day_date}.pdf`} />
              </div>
              <div className="row-price num">{money(d.total)}</div>
            </li>
          );
        })}
        {!days.length && (
          <li className="row">
            <div className="row-main">
              <div className="row-name">No reports yet</div>
              <div className="row-meta">Open the shop and record a sale. Each day gets its own PDF.</div>
            </div>
          </li>
        )}
      </ul>
    </main>
  );
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "shop";
