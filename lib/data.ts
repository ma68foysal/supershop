import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "./supabase/server";
import { addDays, pctChange } from "./format";
import type { BusinessDay, Product, Sale, Settings, Staff } from "./types";

/**
 * Everything most screens need, loaded once per request:
 * the signed-in staff member, shop settings and the open day (if any).
 * Also applies the automatic open/close schedule before reading.
 */
export const getShop = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  await supabase.rpc("auto_tick");

  const [me, settings, openDay] = await Promise.all([
    supabase.from("staff").select("id,name,role,active").eq("id", user.id).maybeSingle(),
    supabase.from("settings").select("*").eq("id", 1).single(),
    supabase.from("business_days").select("*").eq("status", "open").maybeSingle(),
  ]);

  if (!me.data || !me.data.active) redirect("/login?error=inactive");

  return {
    supabase,
    me: me.data as Staff,
    settings: settings.data as Settings,
    openDay: (openDay.data as BusinessDay | null) ?? null,
  };
});

export async function getProducts(includeInactive = false) {
  const { supabase } = await getShop();
  let q = supabase.from("products").select("*").order("name");
  if (!includeInactive) q = q.eq("active", true);
  const { data } = await q;
  return (data ?? []) as Product[];
}

export async function getSales(dayId: string) {
  const { supabase } = await getShop();
  const { data } = await supabase
    .from("sales")
    .select("*, sale_items(id,product_id,name,unit,qty,unit_price,line_total)")
    .eq("business_day_id", dayId)
    .order("created_at", { ascending: true });
  return (data ?? []) as Sale[];
}

export async function getStaffNames() {
  const { supabase } = await getShop();
  const { data } = await supabase.from("staff").select("id,name,role,active").order("created_at");
  return (data ?? []) as Staff[];
}

export type DayRow = BusinessDay & { total: number; sales_count: number };

/** Days with their live totals, newest first. */
export async function getDays(limit = 90) {
  const { supabase } = await getShop();
  const { data: days } = await supabase
    .from("business_days")
    .select("*")
    .order("day_date", { ascending: false })
    .order("opened_at", { ascending: false })
    .limit(limit);
  const ids = (days ?? []).map((d) => d.id);
  const { data: totals } = ids.length
    ? await supabase.from("day_totals").select("*").in("business_day_id", ids)
    : { data: [] };
  const byId = new Map((totals ?? []).map((t) => [t.business_day_id, t]));
  return (days ?? []).map((d) => ({
    ...d,
    total: Number(byId.get(d.id)?.total ?? 0),
    sales_count: Number(byId.get(d.id)?.sales_count ?? 0),
  })) as DayRow[];
}

/** Sum of totals per calendar date (a shop may open twice in one date). */
export function totalsByDate(days: DayRow[]) {
  const m = new Map<string, number>();
  for (const d of days) m.set(d.day_date, (m.get(d.day_date) ?? 0) + d.total);
  return m;
}

export type Comparison = { label: string; total: number; pct: number | null };

/** Compare a date's total with the previous trading day, same weekday last week and the 7-day average. */
export function compare(date: string, total: number, byDate: Map<string, number>): Comparison[] {
  const out: Comparison[] = [];
  const earlier = [...byDate.keys()].filter((d) => d < date).sort().reverse();
  if (earlier[0]) {
    const t = byDate.get(earlier[0])!;
    const name = new Date(earlier[0] + "T00:00:00Z").toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });
    out.push({ label: earlier[0] === addDays(date, -1) ? "yesterday" : `${name} (last day open)`, total: t, pct: pctChange(total, t) });
  }
  const lastWeek = addDays(date, -7);
  if (byDate.has(lastWeek)) {
    const name = new Date(date + "T00:00:00Z").toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });
    const t = byDate.get(lastWeek)!;
    out.push({ label: `last ${name}`, total: t, pct: pctChange(total, t) });
  }
  const week = earlier.filter((d) => d >= addDays(date, -7));
  if (week.length >= 2) {
    const avg = Math.round(week.reduce((a, d) => a + byDate.get(d)!, 0) / week.length);
    out.push({ label: `the ${week.length}-day average`, total: avg, pct: pctChange(total, avg) });
  }
  return out;
}
