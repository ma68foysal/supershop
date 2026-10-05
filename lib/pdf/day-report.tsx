import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { Style } from "@react-pdf/stylesheet";
import type { Comparison } from "../data";
import { longDate, moneyTk, qtyLabel, timeOf } from "../format";
import type { BusinessDay, Sale, Settings, Unit } from "../types";

export type DayReport = {
  settings: Settings;
  day: BusinessDay;
  sales: Sale[];
  names: Record<string, string>;
  comparisons: Comparison[];
  generatedAt: string;
};

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

const Row = ({ cells, widths, head, style }: { cells: string[]; widths: (number | string)[]; head?: boolean; style?: Style }) => (
  <View style={style ? [s.tr, style] : s.tr} wrap={false}>
    {cells.map((c, i) => (
      <Text
        key={i}
        style={[
          widths[i] === "flex" ? { flexGrow: 1, flexShrink: 1, paddingRight: 8 } : { width: widths[i] as number },
          head ? s.th : {},
          i === cells.length - 1 ? s.right : {},
        ]}
      >
        {c}
      </Text>
    ))}
  </View>
);

export function DayReportDocument({ r }: { r: DayReport }) {
  const tz = r.settings.timezone;
  const live = r.sales.filter((x) => !x.voided_at);
  const voided = r.sales.filter((x) => x.voided_at);
  const total = live.reduce((a, x) => a + Number(x.total), 0);
  const quick = live.filter((x) => x.kind === "quick").reduce((a, x) => a + Number(x.total), 0);
  const discount = live.reduce((a, x) => a + Number(x.discount), 0);

  const agg = new Map<string, { unit: Unit; qty: number; amount: number }>();
  for (const sale of live)
    for (const i of sale.sale_items) {
      const a = agg.get(i.name) ?? { unit: i.unit, qty: 0, amount: 0 };
      a.qty += Number(i.qty);
      a.amount += Number(i.line_total);
      agg.set(i.name, a);
    }
  const top = [...agg.entries()].sort((a, b) => b[1].amount - a[1].amount).slice(0, 10);

  const d = r.day;
  const opened = `Opened ${timeOf(d.opened_at, tz)}${d.opened_by && r.names[d.opened_by] ? ` by ${r.names[d.opened_by]}` : d.opened_by ? "" : " automatically"}`;
  const closed = d.closed_at
    ? `Closed ${timeOf(d.closed_at, tz)}${d.close_type === "auto" ? " automatically" : d.closed_by && r.names[d.closed_by] ? ` by ${r.names[d.closed_by]}` : ""}`
    : "Still open, figures so far";
  const expectedCash = Number(d.opening_cash) + total;

  return (
    <Document title={`${r.settings.shop_name} sales ${d.day_date}`} author={r.settings.shop_name}>
      <Page size="A4" style={s.page}>
        <View style={s.band} fixed />
        <View style={s.header}>
          <View>
            <Text style={s.shop}>{r.settings.shop_name}</Text>
            {r.settings.address ? <Text style={s.muted}>{r.settings.address}</Text> : null}
            {r.settings.phone ? <Text style={s.muted}>{r.settings.phone}</Text> : null}
          </View>
          <View style={s.right}>
            <Text style={[s.bold, { fontSize: 12 }]}>Daily sales report</Text>
            <Text style={s.muted}>{longDate(d.day_date)}</Text>
            <Text style={s.muted}>{opened}</Text>
            <Text style={s.muted}>{closed}</Text>
          </View>
        </View>

        <View style={s.result}>
          <Text style={s.big}>{moneyTk(total)}</Text>
          <View>
            {r.comparisons.length ? (
              r.comparisons.map((c) => (
                <Text key={c.label} style={{ marginVertical: 1 }}>
                  <Text style={[s.bold, { color: (c.pct ?? 0) >= 0 ? C.leaf : C.khata }]}>
                    {c.pct === null ? "" : `${c.pct >= 0 ? "Up" : "Down"} ${Math.abs(c.pct)}%`}
                  </Text>
                  {` on ${c.label} (${moneyTk(c.total)})`}
                </Text>
              ))
            ) : (
              <Text style={s.muted}>No earlier days to compare with yet.</Text>
            )}
          </View>
        </View>

        <View style={s.cols}>
          <View style={s.col}>
            <Text style={s.h}>Summary</Text>
            <Row widths={["flex", 90]} cells={["Sales", String(live.length)]} />
            <Row widths={["flex", 90]} cells={["Average sale", moneyTk(live.length ? Math.round(total / live.length) : 0)]} />
            <Row widths={["flex", 90]} cells={["Recorded item by item", moneyTk(total - quick)]} />
            <Row widths={["flex", 90]} cells={["Recorded as total only", moneyTk(quick)]} />
            {discount > 0 ? <Row widths={["flex", 90]} cells={["Discounts given", moneyTk(discount)]} /> : null}
            {voided.length ? <Row widths={["flex", 90]} cells={["Voided sales (not counted)", String(voided.length)]} /> : null}
            {d.counted_cash !== null ? (
              <>
                <Row widths={["flex", 90]} cells={["Cash expected in drawer", moneyTk(expectedCash)]} />
                <Row widths={["flex", 90]} cells={["Cash counted", moneyTk(Number(d.counted_cash))]} />
                <Row
                  widths={["flex", 90]}
                  style={s.bold}
                  cells={[
                    "Difference",
                    (Number(d.counted_cash) - expectedCash >= 0 ? "+" : "-") +
                      moneyTk(Math.abs(Number(d.counted_cash) - expectedCash)),
                  ]}
                />
              </>
            ) : null}
          </View>
          <View style={s.col}>
            <Text style={s.h}>Top items</Text>
            {top.length ? (
              <>
                <Row head widths={["flex", 50, 70]} cells={["Item", "Qty", "Amount"]} />
                {top.map(([name, v]) => (
                  <Row key={name} widths={["flex", 50, 70]} cells={[name, qtyLabel(v.qty, v.unit), moneyTk(v.amount)]} />
                ))}
              </>
            ) : (
              <Text style={s.muted}>All sales were recorded as totals only.</Text>
            )}
          </View>
        </View>

        <Text style={s.h}>All sales</Text>
        <Row head widths={[28, 52, "flex", 70]} cells={["#", "Time", "Details", "Amount"]} />
        {r.sales.map((x) => {
          const details =
            x.kind === "quick"
              ? `Total only${x.note ? `: ${x.note}` : ""}`
              : x.sale_items.map((i) => `${i.name} × ${qtyLabel(Number(i.qty), i.unit)}`).join(", ") +
                (Number(x.discount) > 0 ? ` (discount ${moneyTk(Number(x.discount))})` : "");
          return (
            <Row
              key={x.id}
              widths={[28, 52, "flex", 70]}
              style={x.voided_at ? { color: C.ink3 } : undefined}
              cells={[
                String(x.receipt_no),
                timeOf(x.created_at, tz),
                (x.voided_at ? `VOIDED${x.void_reason ? ` (${x.void_reason})` : ""}: ` : "") + details,
                moneyTk(Number(x.total)),
              ]}
            />
          );
        })}
        {!r.sales.length ? <Text style={[s.muted, { marginTop: 4 }]}>No sales were recorded.</Text> : null}

        <View style={s.footer} fixed>
          <Text>Made by Dokan, {r.generatedAt}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
