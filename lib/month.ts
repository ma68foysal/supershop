import "server-only";
import type { createClient } from "./supabase/server";
import type { Unit } from "./types";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Totals for a date range, worked out by the database function period_report. */
export type PeriodReport = {
  days: { date: string; total: number; sales: number }[];
  total: number;
  sales: number;
  quick_total: number;
  items_total: number;
  discount: number;
  voids: number;
  top_items: { name: string; unit: Unit; qty: number; amount: number }[];
  /** item sales, and the part of them whose buying price is known */
  item_revenue: number;
  costed_revenue: number;
  cost: number;
};

export type MonthReport = {
  month: string; // "2026-10"
  from: string;
  to: string;
  isCurrent: boolean;
  /** this month (to today, if it's the current month) */
  cur: PeriodReport;
  /** last month: the same days so far if this month isn't over, else the whole month */
  prev: PeriodReport;
  prevMonth: string;
  sameDays: boolean;
  profit: number | null;
  margin: number | null;
  /** share of item sales whose buying price is known, 0–100 */
  costCoverage: number;
};

export const isMonth = (m: unknown): m is string => typeof m === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(m);
export const todayIn = (tz: string) => new Date().toLocaleDateString("en-CA", { timeZone: tz }); // YYYY-MM-DD

export const monthBounds = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(days).padStart(2, "0")}`, days };
};

export const shiftMonth = (month: string, n: number) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
};

async function period(supabase: Supabase, from: string, to: string): Promise<PeriodReport> {
  const { data, error } = await supabase.rpc("period_report", { p_from: from, p_to: to });
  if (error) throw new Error(error.message);
  const r = data as PeriodReport;
  const n = (v: unknown) => Number(v ?? 0);
  return {
    ...r,
    total: n(r.total),
    sales: n(r.sales),
    quick_total: n(r.quick_total),
    items_total: n(r.items_total),
    discount: n(r.discount),
    voids: n(r.voids),
    item_revenue: n(r.item_revenue),
    costed_revenue: n(r.costed_revenue),
    cost: n(r.cost),
    days: (r.days ?? []).map((d) => ({ date: d.date, total: n(d.total), sales: n(d.sales) })),
    top_items: (r.top_items ?? []).map((t) => ({ ...t, qty: n(t.qty), amount: n(t.amount) })),
  };
}

export async function getMonthReport(supabase: Supabase, month: string, tz: string): Promise<MonthReport> {
  const today = todayIn(tz);
  const isCurrent = today.startsWith(month);
  const { from, to } = monthBounds(month);
  const prevMonth = shiftMonth(month, -1);
  const pb = monthBounds(prevMonth);
  // Mid-month, compare with the same days of last month (1–9 Oct vs 1–9 Sep), not all of September
  const prevTo = isCurrent
    ? `${prevMonth}-${String(Math.min(Number(today.slice(8)), pb.days)).padStart(2, "0")}`
    : pb.to;

  const [cur, prev] = await Promise.all([
    period(supabase, from, isCurrent ? today : to),
    period(supabase, pb.from, prevTo),
  ]);
  const profit = cur.costed_revenue > 0 ? cur.costed_revenue - cur.cost : null;
  return {
    month,
    from,
    to,
    isCurrent,
    cur,
    prev,
    prevMonth,
    sameDays: isCurrent,
    profit,
    margin: profit !== null ? Math.round((profit / cur.costed_revenue) * 100) : null,
    costCoverage: cur.item_revenue > 0 ? Math.round((cur.costed_revenue / cur.item_revenue) * 100) : 0,
  };
}
