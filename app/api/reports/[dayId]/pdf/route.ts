import { createElement, type ReactElement } from "react";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { compare, totalsByDate, type DayRow } from "@/lib/data";
import { addDays } from "@/lib/format";
import { DayReportDocument } from "@/lib/pdf/day-report";
import { createClient } from "@/lib/supabase/server";
import type { Sale, Settings } from "@/lib/types";

export async function GET(request: Request, ctx: RouteContext<"/api/reports/[dayId]/pdf">) {
  const { dayId } = await ctx.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Sign in to see reports", { status: 401 });

  const { data: day } = await supabase.from("business_days").select("*").eq("id", dayId).maybeSingle();
  if (!day) return new Response("Report not found", { status: 404 });

  // Days in the 8 days before, for comparisons
  const [{ data: settings }, { data: sales }, { data: staff }, { data: around }] = await Promise.all([
    supabase.from("settings").select("*").eq("id", 1).single(),
    supabase
      .from("sales")
      .select("*, sale_items(product_id,name,unit,qty,unit_price,line_total)")
      .eq("business_day_id", dayId)
      .order("created_at"),
    supabase.from("staff").select("id,name"),
    supabase
      .from("business_days")
      .select("id,day_date")
      .gte("day_date", addDays(day.day_date, -8))
      .lte("day_date", day.day_date),
  ]);
  const ids = (around ?? []).map((d) => d.id);
  const { data: totals } = await supabase.from("day_totals").select("*").in("business_day_id", ids);
  const totalById = new Map((totals ?? []).map((t) => [t.business_day_id, Number(t.total)]));
  const rows = (around ?? []).map((d) => ({ ...d, total: totalById.get(d.id) ?? 0 })) as DayRow[];
  const byDate = totalsByDate(rows);

  const s = settings as Settings;
  const buffer = await renderToBuffer(
    createElement(DayReportDocument, {
      r: {
        settings: s,
        day,
        sales: (sales ?? []) as Sale[],
        names: Object.fromEntries((staff ?? []).map((x) => [x.id, x.name])),
        comparisons: compare(day.day_date, byDate.get(day.day_date) ?? 0, byDate),
        generatedAt: new Date().toLocaleString("en-GB", { timeZone: s.timezone, dateStyle: "medium", timeStyle: "short" }),
      },
    }) as unknown as ReactElement<DocumentProps>, // the component renders a <Document>
  );

  const name = `${s.shop_name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${day.day_date}.pdf`;
  const download = new URL(request.url).searchParams.has("download");
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${name}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
