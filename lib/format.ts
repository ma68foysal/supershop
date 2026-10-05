import type { Unit } from "./types";

const num = (n: number) => Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 });

/** ৳1,25,000 — Bangladeshi digit grouping */
export const money = (n: number) => "৳" + num(n);
/** PDF fonts have no ৳ glyph, so reports use "Tk". */
export const moneyTk = (n: number) => "Tk " + num(n);

export const qtyLabel = (qty: number, unit: Unit) => {
  const q = num(qty);
  if (unit === "pcs") return q;
  if (unit === "dozen") return `${q} dz`;
  return `${q} ${unit}`;
};

export const unitLabel = (unit: Unit) =>
  ({ pcs: "piece", kg: "kg", g: "gram", L: "litre", ml: "ml", pack: "pack", dozen: "dozen" })[unit];

/** Quantity step for cart buttons: half a kilo/litre, one of everything else. */
export const qtyStep = (unit: Unit) => (unit === "kg" || unit === "L" ? 0.5 : unit === "g" || unit === "ml" ? 100 : 1);

export const timeOf = (iso: string, tz: string) =>
  new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz });

/** "08:00:00" → "8:00 AM" */
export const clock12 = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};

/** "2026-10-05" → "Mon 5 Oct" */
export const shortDate = (d: string) =>
  new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });

/** "2026-10-05" → "Monday 5 October 2026" */
export const longDate = (d: string) =>
  new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

export const addDays = (d: string, n: number) => {
  const x = new Date(d + "T00:00:00Z");
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

export const pctChange = (now: number, before: number) =>
  before > 0 ? Math.round(((now - before) / before) * 100) : null;
