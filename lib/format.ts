import type { Unit } from "./types";

export type Lang = "bn" | "en";

const BN_DIGITS = "০১২৩৪৫৬৭৮৯";
export const toBnDigits = (s: string) => s.replace(/\d/g, (d) => BN_DIGITS[Number(d)]);
/** Bangla keyboards type ০-৯; the database needs 0-9. */
export const toAsciiDigits = (s: string) => s.replace(/[০-৯]/g, (d) => String(BN_DIGITS.indexOf(d)));

/** Lakh grouping in both languages: 1,25,000 / ১,২৫,০০০ */
export const num = (n: number, lang: Lang = "en") =>
  Number(n).toLocaleString(lang === "bn" ? "bn-BD" : "en-IN", { maximumFractionDigits: 2 });

export const money = (n: number, lang: Lang = "en") => "৳" + num(n, lang);
/** PDF fonts have no ৳ glyph, so reports use "Tk". */
export const moneyTk = (n: number) => "Tk " + num(n);

const UNIT_NAMES: Record<Lang, Record<Unit, string>> = {
  en: { pcs: "piece", kg: "kg", g: "gram", L: "litre", ml: "ml", pack: "pack", dozen: "dozen", hali: "hali" },
  bn: { pcs: "পিস", kg: "কেজি", g: "গ্রাম", L: "লিটার", ml: "মি.লি.", pack: "প্যাকেট", dozen: "ডজন", hali: "হালি" },
};
export const unitLabel = (unit: Unit, lang: Lang = "en") => UNIT_NAMES[lang][unit];

export const qtyLabel = (qty: number, unit: Unit, lang: Lang = "en"): string => {
  // Under a kilo or litre reads better as grams / ml: 0.077 kg → 77 g
  if ((unit === "kg" || unit === "L") && qty > 0 && qty < 1) {
    return qtyLabel(Math.round(qty * 1000), unit === "kg" ? "g" : "ml", lang);
  }
  const q = num(qty, lang);
  if (unit === "pcs") return q;
  if (lang === "bn") return `${q} ${UNIT_NAMES.bn[unit]}`;
  if (unit === "dozen") return `${q} dz`;
  return `${q} ${unit}`;
};

/** Quantity step for cart buttons: half a kilo/litre, one of everything else. */
export const qtyStep = (unit: Unit) => (unit === "kg" || unit === "L" ? 0.5 : unit === "g" || unit === "ml" ? 100 : 1);

/** Bangladeshi way of saying the time: সকাল ৮:০২, রাত ১০:৩৫ */
const bnPeriod = (h: number) =>
  h < 4 ? "রাত" : h < 6 ? "ভোর" : h < 12 ? "সকাল" : h < 15 ? "দুপুর" : h < 18 ? "বিকাল" : h < 20 ? "সন্ধ্যা" : "রাত";

const clockHM = (h: number, m: number, lang: Lang) => {
  const hm = `${h % 12 || 12}:${String(m).padStart(2, "0")}`;
  return lang === "bn" ? `${bnPeriod(h)} ${toBnDigits(hm)}` : `${hm} ${h < 12 ? "AM" : "PM"}`;
};

export const timeOf = (iso: string, tz: string, lang: Lang = "en") => {
  const parts = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
    timeZone: tz,
  }).formatToParts(new Date(iso));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return clockHM(get("hour") % 24, get("minute"), lang);
};

/** "08:00:00" → "8:00 AM" / "সকাল ৮:০০" */
export const clock12 = (t: string, lang: Lang = "en") => {
  const [h, m] = t.split(":").map(Number);
  return clockHM(h, m, lang);
};

const dateFmt = (d: string, lang: Lang, opts: Intl.DateTimeFormatOptions) =>
  new Date(d + "T00:00:00Z").toLocaleDateString(lang === "bn" ? "bn-BD" : "en-GB", { ...opts, timeZone: "UTC" });

/** "2026-10-05" → "Mon 5 Oct" / "সোম ৫ অক্টো" */
export const shortDate = (d: string, lang: Lang = "en") =>
  dateFmt(d, lang, { weekday: "short", day: "numeric", month: "short" });

/** "2026-10-05" → "Mon" / "সোম" */
export const weekdayShort = (d: string, lang: Lang = "en") => dateFmt(d, lang, { weekday: "short" });

/** "2026-10-05" → "Monday 5 October 2026" */
export const longDate = (d: string, lang: Lang = "en") =>
  dateFmt(d, lang, { weekday: "long", day: "numeric", month: "long", year: "numeric" });

export const addDays = (d: string, n: number) => {
  const x = new Date(d + "T00:00:00Z");
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

export const pctChange = (now: number, before: number) =>
  before > 0 ? Math.round(((now - before) / before) * 100) : null;

/** All screen formatters bound to one language. */
export const formatters = (lang: Lang) => ({
  num: (n: number) => num(n, lang),
  money: (n: number) => money(n, lang),
  digits: (s: string | number) => (lang === "bn" ? toBnDigits(String(s)) : String(s)),
  qty: (q: number, u: Unit) => qtyLabel(q, u, lang),
  unit: (u: Unit) => unitLabel(u, lang),
  time: (iso: string, tz: string) => timeOf(iso, tz, lang),
  clock: (t: string) => clock12(t, lang),
  date: (d: string) => shortDate(d, lang),
  weekday: (d: string) => weekdayShort(d, lang),
});
export type Formatters = ReturnType<typeof formatters>;

/* ---------- phone numbers ---------- */
/** Keep + and digits (Bangla digits converted) for tel: links. */
export const cleanPhone = (p: string) => toAsciiDigits(p).replace(/[^\d+]/g, "");
export const telHref = (p: string) => "tel:" + cleanPhone(p);
/** WhatsApp needs the country code: 017… → 88017… */
export const waHref = (p: string) => {
  let d = cleanPhone(p).replace(/^\+/, "");
  if (d.startsWith("0") && d.length === 11) d = "88" + d;
  return "https://wa.me/" + d;
};

/** Day of the week (0 = Sunday) right now in the shop's timezone. */
export const weekdayNow = (tz: string) => {
  const name = new Date().toLocaleDateString("en-US", { weekday: "short", timeZone: tz });
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(name);
};
/** Bangladeshi week order: Saturday first. */
export const WEEK_ORDER = [6, 0, 1, 2, 3, 4, 5];
