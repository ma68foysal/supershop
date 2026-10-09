import { createElement, type ReactElement } from "react";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { getMonthReport, isMonth } from "@/lib/month";
import { MonthReportDocument } from "@/lib/pdf/month-report";
import { createClient } from "@/lib/supabase/server";
import type { Settings } from "@/lib/types";

export async function GET(request: Request, ctx: RouteContext<"/api/reports/month/[month]/pdf">) {
  const { month } = await ctx.params;
  if (!isMonth(month)) return new Response("Use a month like 2026-10", { status: 400 });
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Sign in to see reports", { status: 401 });

  const { data: settings } = await supabase.from("settings").select("*").eq("id", 1).single();
  const s = settings as Settings;
  const r = await getMonthReport(supabase, month, s.timezone);

  const buffer = await renderToBuffer(
    createElement(MonthReportDocument, {
      r,
      settings: s,
      generatedAt: new Date().toLocaleString("en-GB", { timeZone: s.timezone, dateStyle: "medium", timeStyle: "short" }),
    }) as unknown as ReactElement<DocumentProps>, // the component renders a <Document>
  );

  const name = `${s.shop_name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${month}.pdf`;
  const download = new URL(request.url).searchParams.has("download");
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${name}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
