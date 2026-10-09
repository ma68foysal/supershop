import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { Style } from "@react-pdf/stylesheet";
import { monthName, moneyTk, pctChange, qtyLabel, shortDate } from "../format";
import type { MonthReport } from "../month";
import type { Settings } from "../types";

const C = { khata: "#9E1B22", ink: "#1B2B4B", ink2: "#4B5A75", ink3: "#7D899E", rule: "#DCE5EE", leaf: "#2F7A4A" };

const s = StyleSheet.create({
  page: { paddingTop: 44, paddingBottom: 54, paddingHorizontal: 40, fontSize: 9.5, color: C.ink, fontFamily: "Helvetica" },
  band: { position: "absolute", top: 0, left: 0, right: 0, height: 8, backgroundColor: C.khata },
  header: { flexDirection: "row", justifyContent: "space-between", borderBottomWidth: 1.5, borderBottomColor: C.ink, paddingBottom: 10 },
  shop: { fontSize: 18, fontFamily: "Helvetica-Bold" },
  muted: { color: C.ink2 },
  right: { textAlign: "right" },
  result: { flexDirection: "row", alignItems: "center", marginTop: 16, marginBottom: 6, padding: 12, borderWidth: 1, borderColor: C.rule, borderLeftWidth: 4, borderLeftColor: C.khata, backgroundColor: "#FAFCF9" },
  big: { fontSize: 28, fontFamily: "Helvetica-Bold", marginRight: 18 },
  h: { fontSize: 10.5, fontFamily: "Helvetica-Bold", marginTop: 16, marginBottom: 4 },
  cols: { flexDirection: "row", gap: 24 },
  col: { flex: 1 },
  tr: { flexDirection: "row", borderBottomWidth: 0.75, borderBottomColor: C.rule, paddingVertical: 3.5 },
  th: { color: C.ink3, fontSize: 8.5 },
  bold: { fontFamily: "Helvetica-Bold" },
  footer: { position: "absolute", bottom: 24, left: 40, right: 40, flexDirection: "row", justifyContent: "space-between", color: C.ink3, fontSize: 8 },
});

const Row = ({ cells, widths, head, style }: { cells: string[]; widths: (number | "flex")[]; head?: boolean; style?: Style }) => (
  <View style={style ? [s.tr, style] : s.tr} wrap={false}>
    {cells.map((c, i) => (
      <Text
        key={i}
        style={[
          widths[i] === "flex" ? { flexGrow: 1, flexShrink: 1, paddingRight: 8 } : { width: widths[i] as number },
          head ? s.th : {},
          i > 0 ? s.right : {},
        ]}
      >
        {c}
      </Text>
    ))}
  </View>
);

export function MonthReportDocument({ r, settings, generatedAt }: { r: MonthReport; settings: Settings; generatedAt: string }) {
  const { cur, prev } = r;
  const pct = pctChange(cur.total, prev.total);
  const daysOpen = cur.days.length;
  const W2: (number | "flex")[] = ["flex", 90];

  return (
    <Document title={`${settings.shop_name} sales ${r.month}`} author={settings.shop_name}>
      <Page size="A4" style={s.page}>
        <View style={s.band} fixed />
        <View style={s.header}>
          <View>
            <Text style={s.shop}>{settings.shop_name}</Text>
            {settings.address ? <Text style={s.muted}>{settings.address}</Text> : null}
            {settings.phone ? <Text style={s.muted}>{settings.phone}</Text> : null}
          </View>
          <View style={s.right}>
            <Text style={[s.bold, { fontSize: 12 }]}>Monthly sales report</Text>
            <Text style={s.muted}>{monthName(r.month)}</Text>
            <Text style={s.muted}>{r.isCurrent ? `1st to ${shortDate(cur.days.at(-1)?.date ?? r.from)} so far` : "Whole month"}</Text>
          </View>
        </View>

        <View style={s.result}>
          <Text style={s.big}>{moneyTk(cur.total)}</Text>
          <View>
            {pct !== null ? (
              <Text>
                <Text style={[s.bold, { color: pct >= 0 ? C.leaf : C.khata }]}>{`${pct >= 0 ? "Up" : "Down"} ${Math.abs(pct)}%`}</Text>
                {` on ${r.sameDays ? "the same days of" : ""} ${monthName(r.prevMonth)} (${moneyTk(prev.total)})`}
              </Text>
            ) : (
              <Text style={s.muted}>No sales last month to compare with.</Text>
            )}
            <Text style={s.muted}>{`${daysOpen} days open, ${cur.sales} sales`}</Text>
          </View>
        </View>

        <View style={s.cols}>
          <View style={s.col}>
            <Text style={s.h}>Summary</Text>
            <Row widths={W2} cells={["Days open", String(daysOpen)]} />
            <Row widths={W2} cells={["Average a day", moneyTk(daysOpen ? Math.round(cur.total / daysOpen) : 0)]} />
            <Row widths={W2} cells={["Sales", String(cur.sales)]} />
            <Row widths={W2} cells={["Average sale", moneyTk(cur.sales ? Math.round(cur.total / cur.sales) : 0)]} />
            <Row widths={W2} cells={["Recorded item by item", moneyTk(cur.items_total)]} />
            <Row widths={W2} cells={["Recorded as total only", moneyTk(cur.quick_total)]} />
            {cur.discount > 0 ? <Row widths={W2} cells={["Discounts given", moneyTk(cur.discount)]} /> : null}
            {cur.voids ? <Row widths={W2} cells={["Voided sales (not counted)", String(cur.voids)]} /> : null}

            <Text style={s.h}>Profit</Text>
            {r.profit !== null ? (
              <>
                <Row widths={W2} cells={["Sales of items with a buying price", moneyTk(cur.costed_revenue)]} />
                <Row widths={W2} cells={["Their buying cost", moneyTk(cur.cost)]} />
                <Row widths={W2} style={s.bold} cells={[`Profit (${r.margin}% margin)`, moneyTk(r.profit)]} />
                <Text style={[s.muted, { marginTop: 4, fontSize: 8 }]}>
                  {`Before discounts. Buying prices known for ${r.costCoverage}% of item sales; total-only sales not included.`}
                </Text>
              </>
            ) : (
              <Text style={s.muted}>Add buying prices to products to see profit.</Text>
            )}
          </View>
          <View style={s.col}>
            <Text style={s.h}>Top items</Text>
            {cur.top_items.length ? (
              <>
                <Row head widths={["flex", 60, 70]} cells={["Item", "Qty", "Amount"]} />
                {cur.top_items.map((it) => (
                  <Row key={it.name + it.unit} widths={["flex", 60, 70]} cells={[it.name, qtyLabel(it.qty, it.unit), moneyTk(it.amount)]} />
                ))}
              </>
            ) : (
              <Text style={s.muted}>All sales were recorded as totals only.</Text>
            )}
          </View>
        </View>

        <Text style={s.h}>Day by day</Text>
        <Row head widths={["flex", 60, 80]} cells={["Date", "Sales", "Total"]} />
        {cur.days.map((d) => (
          <Row key={d.date} widths={["flex", 60, 80]} cells={[shortDate(d.date), String(d.sales), moneyTk(d.total)]} />
        ))}
        {!cur.days.length ? <Text style={[s.muted, { marginTop: 4 }]}>The shop was not opened this month.</Text> : null}

        <View style={s.footer} fixed>
          <Text>Made by Dokan, {generatedAt}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
