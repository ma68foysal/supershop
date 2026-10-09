import Link from "next/link";
import { notFound } from "next/navigation";
import SalesList from "@/components/sales-list";
import { getSales, getShop, getStaffNames } from "@/lib/data";
import { getI18n } from "@/lib/i18n-server";
import type { BusinessDay } from "@/lib/types";
import ReportActions from "../report-actions";
import DayTools from "./day-tools";

export const metadata = { title: "Report · Dokan" };

export default async function DayReportPage(props: PageProps<"/reports/[dayId]">) {
  const { dayId } = await props.params;
  const [{ supabase, settings }, { t, f }] = await Promise.all([getShop(), getI18n()]);
  const { data } = await supabase.from("business_days").select("*").eq("id", dayId).maybeSingle();
  if (!data) notFound();
  const day = data as BusinessDay;

  const [sales, staff] = await Promise.all([getSales(day.id), getStaffNames()]);
  const live = sales.filter((s) => !s.voided_at);
  const total = live.reduce((a, s) => a + Number(s.total), 0);
  const tz = settings.timezone;
  const fileName = `${settings.shop_name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "shop"}-${day.day_date}.pdf`;

  return (
    <main className="main">
      <Link href="/reports" className="link back-link">
        {t.allReports}
      </Link>
      <h2 className="h2">
        {f.date(day.day_date)}
        {day.status === "open" && <span className="tag">{t.openNow}</span>}
      </h2>
      <p className="sub">
        {t.salesCount(f.num(live.length))}, {f.time(day.opened_at, tz)}–
        {day.closed_at ? f.time(day.closed_at, tz) : t.now}
        {day.counted_cash !== null && <>, {t.countedCash.split(" (")[0]}: {f.money(day.counted_cash)}</>}
      </p>

      <div className="ledger" style={{ marginTop: 12 }}>
        <div className="ledger-label">{t.soldOn(f.date(day.day_date))}</div>
        <div className="ledger-amount" style={{ fontSize: 64 }}>
          <span className="tk">৳</span>
          <span>{f.num(total)}</span>
        </div>
      </div>
      <ReportActions dayId={day.id} fileName={fileName} />

      <DayTools day={day} salesCount={live.length} total={total} />

      <div className="section-head">
        <h3>{t.salesHeading}</h3>
        <span className="sub">{sales.length ? t.newestFirst : ""}</span>
      </div>
      <SalesList sales={sales} staff={staff} tz={tz} canChange />
    </main>
  );
}
