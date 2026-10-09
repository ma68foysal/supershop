import "server-only";
import { ApiError, GoogleGenAI, type Content, type FunctionCall, type FunctionDeclaration } from "@google/genai";
import { timeOf, toAsciiDigits, type Lang } from "../format";
import type { createClient } from "../supabase/server";
import { UNITS, type Product, type Settings, type Sr, type Staff, type Unit } from "../types";
import type { ChatTurn, ProductFields, Proposal, SaleLine } from "./proposals";

/**
 * Tried in order; a later one is used when Google says the first is busy or over its free
 * per-minute limit (each model has its own). gemini-3.8-flash allows only 5 requests a minute
 * on the free tier and is often overloaded, so it goes last.
 */
const MODELS = (process.env.GEMINI_MODELS ?? "gemini-3.5-flash,gemini-3.1-flash-lite,gemini-3.8-flash")
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);
const MAX_STEPS = 6;
const MAX_HISTORY = 20;

type Supabase = Awaited<ReturnType<typeof createClient>>;
type Ctx = {
  supabase: Supabase;
  me: Staff;
  settings: Settings;
  lang: Lang;
  proposals: Proposal[];
  products?: Product[];
};

export class AssistantError extends Error {
  constructor(public code: "quota" | "busy" | "config" | "failed") {
    super(code);
  }
}

/* ---------------- tool declarations ---------------- */
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties,
  required,
});

const TOOLS: FunctionDeclaration[] = [
  {
    name: "search_products",
    description:
      "Find the shop's products by Bangla name, English name, short code or category. Returns product_id, names, unit, price per unit and stock. Use an empty query to list all products.",
    parametersJsonSchema: obj({ query: { type: "string" } }, ["query"]),
  },
  {
    name: "today_summary",
    description: "Is the shop open, today's total sales so far, number of sales, top items, and the previous day's total.",
    parametersJsonSchema: obj({}),
  },
  {
    name: "low_stock",
    description: "Products at or below their low-stock warning level, with the SR (company sales rep) who brings each.",
    parametersJsonSchema: obj({}),
  },
  {
    name: "recent_sales",
    description: "The latest sales of the current day (receipt number, time, items, total, voided or not).",
    parametersJsonSchema: obj({ limit: { type: "integer", description: "How many, default 5" } }),
  },
  {
    name: "find_srs",
    description: "Find company SRs (sales reps) by name, company or phone. Empty query lists all.",
    parametersJsonSchema: obj({ query: { type: "string" } }, ["query"]),
  },
  {
    name: "propose_quick_sale",
    description: "Prepare a 'total only' sale of a taka amount with no products. Shown to the user to confirm.",
    parametersJsonSchema: obj(
      { total: { type: "number", description: "Amount in taka" }, note: { type: "string" } },
      ["total"],
    ),
  },
  {
    name: "propose_item_sale",
    description:
      "Prepare a sale of specific products. Each item has product_id (from search_products) and either qty in the product's unit, or amount_taka when the customer buys by money (e.g. '১০ টাকার চিনি'). Shown to the user to confirm.",
    parametersJsonSchema: obj(
      {
        items: {
          type: "array",
          items: obj(
            {
              product_id: { type: "string" },
              qty: { type: "number" },
              amount_taka: { type: "number" },
            },
            ["product_id"],
          ),
        },
        discount_taka: { type: "number" },
        note: { type: "string" },
      },
      ["items"],
    ),
  },
  {
    name: "propose_product_update",
    description:
      "Prepare a change to one product: English name, Bangla name, short code, category, favourite, selling price, stock received (add_stock), a corrected stock count (set_stock), or the low-stock warning level. Only pass the fields that change. Shown to the user to confirm.",
    parametersJsonSchema: obj(
      {
        product_id: { type: "string" },
        new_name: { type: "string", description: "English name, printed on reports" },
        new_name_bn: { type: "string", description: "Bangla name" },
        new_short_code: { type: "string" },
        new_category: { type: "string" },
        favourite: { type: "boolean", description: "Show in Favourites on the Sell screen" },
        new_price: { type: "number" },
        add_stock: { type: "number" },
        set_stock: { type: "number" },
        low_stock_warning: { type: "number" },
      },
      ["product_id"],
    ),
  },
  {
    name: "propose_new_product",
    description:
      "Prepare a new product. name is in English (it is printed on reports); name_bn is the Bangla name. Shown to the user to confirm.",
    parametersJsonSchema: obj(
      {
        name: { type: "string" },
        name_bn: { type: "string" },
        unit: { type: "string", enum: UNITS },
        sell_price: { type: "number" },
        stock: { type: "number" },
        category: { type: "string" },
      },
      ["name", "unit", "sell_price"],
    ),
  },
  {
    name: "propose_new_sr",
    description: "Prepare a new company SR (sales rep) with phone number. Shown to the user to confirm.",
    parametersJsonSchema: obj(
      {
        name: { type: "string" },
        phone: { type: "string" },
        company: { type: "string" },
        note: { type: "string" },
      },
      ["name", "phone"],
    ),
  },
  {
    name: "propose_open_shop",
    description: "Prepare opening the shop for the day. Shown to the user to confirm.",
    parametersJsonSchema: obj({}),
  },
  {
    name: "propose_close_shop",
    description: "Prepare closing the shop for the day (this makes the day's report). Shown to the user to confirm.",
    parametersJsonSchema: obj({}),
  },
  {
    name: "propose_void_sale",
    description:
      "Prepare voiding (cancelling) one of today's sales by its receipt number, e.g. a mistake. Shown to the user to confirm.",
    parametersJsonSchema: obj({ receipt_no: { type: "integer" } }, ["receipt_no"]),
  },
];

/* ---------------- tool implementations ---------------- */
type Result = Record<string, unknown>;
const pos = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n > 0;
const money2 = (n: number) => Math.round(n * 100) / 100;

async function products(ctx: Ctx) {
  if (!ctx.products) {
    const { data } = await ctx.supabase.from("products").select("*").order("name");
    ctx.products = (data ?? []) as Product[];
  }
  return ctx.products;
}

// Never includes the buying price
const productView = (p: Product) => ({
  product_id: p.id,
  name: p.name,
  name_bn: p.name_bn,
  short_code: p.short_code,
  category: p.category,
  unit: p.unit,
  price_per_unit: Number(p.sell_price),
  stock: Number(p.stock_qty),
  low_stock_warning: p.low_stock_at === null ? null : Number(p.low_stock_at),
});

const matches = (query: string, ...fields: (string | null)[]) => {
  const q = toAsciiDigits(query).toLowerCase().trim();
  if (!q) return true;
  const hay = fields.filter(Boolean).join(" ").toLowerCase();
  return hay.includes(q) || q.split(/\s+/).every((w) => hay.includes(w));
};

async function openDay(ctx: Ctx) {
  const { data } = await ctx.supabase.from("business_days").select("*").eq("status", "open").maybeSingle();
  return data as { id: string; opened_at: string; day_date: string } | null;
}

async function dayTotal(ctx: Ctx, dayId: string) {
  const { data } = await ctx.supabase.from("day_totals").select("total,sales_count").eq("business_day_id", dayId).single();
  return { total: Number(data?.total ?? 0), count: Number(data?.sales_count ?? 0) };
}

type SaleRow = {
  id: string;
  receipt_no: number;
  created_at: string;
  total: number;
  kind: string;
  note: string | null;
  voided_at: string | null;
  sale_items: { name: string; qty: number; unit: Unit }[];
};

async function daySales(ctx: Ctx, dayId: string) {
  const { data } = await ctx.supabase
    .from("sales")
    .select("id,receipt_no,created_at,total,kind,note,voided_at,sale_items(name,qty,unit)")
    .eq("business_day_id", dayId)
    .order("created_at", { ascending: false });
  return (data ?? []) as SaleRow[];
}

const saleSummary = (s: SaleRow) =>
  s.kind === "quick" ? `total only${s.note ? ` (${s.note})` : ""}` : s.sale_items.map((i) => `${i.name} × ${i.qty} ${i.unit}`).join(", ");

const handlers: Record<string, (args: Record<string, unknown>, ctx: Ctx) => Promise<Result>> = {
  async search_products({ query }, ctx) {
    const all = (await products(ctx)).filter((p) => p.active);
    const found = all.filter((p) => matches(String(query ?? ""), p.name, p.name_bn, p.short_code, p.category));
    if (found.length) return { count: found.length, products: found.slice(0, 15).map(productView) };
    // Names can be saved in English only ("Lux mini") or spelled differently (গুরা / গুড়া):
    // give the model every name so it can recognise the product itself
    return {
      count: 0,
      hint: "No exact match. Look through all_products for the same product under another spelling or language, then search for it by that name.",
      all_products: all.map((p) => ({ product_id: p.id, name: p.name, name_bn: p.name_bn, unit: p.unit })),
    };
  },

  async today_summary(_, ctx) {
    const day = await openDay(ctx);
    const { data: last } = await ctx.supabase
      .from("business_days")
      .select("id,day_date")
      .eq("status", "closed")
      .order("day_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    const previous = last ? { date: last.day_date, ...(await dayTotal(ctx, last.id)) } : null;
    if (!day) return { shop_open: false, previous_day: previous };
    const sales = (await daySales(ctx, day.id)).filter((s) => !s.voided_at);
    const items = new Map<string, number>();
    for (const s of sales) for (const i of s.sale_items) items.set(i.name, (items.get(i.name) ?? 0) + Number(i.qty));
    return {
      shop_open: true,
      opened_at: timeOf(day.opened_at, ctx.settings.timezone),
      ...(await dayTotal(ctx, day.id)),
      top_items: [...items.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5),
      previous_day: previous,
    };
  },

  async low_stock(_, ctx) {
    const low = (await products(ctx)).filter(
      (p) => p.active && p.low_stock_at !== null && Number(p.stock_qty) <= Number(p.low_stock_at),
    );
    const { data: srs } = await ctx.supabase.from("srs").select("id,name,company,phone");
    const byId = new Map(((srs ?? []) as Sr[]).map((s) => [s.id, s]));
    return {
      count: low.length,
      products: low.map((p) => ({
        ...productView(p),
        sr: p.sr_id && byId.get(p.sr_id) ? byId.get(p.sr_id) : null,
      })),
    };
  },

  async recent_sales({ limit }, ctx) {
    const day = await openDay(ctx);
    if (!day) return { shop_open: false, sales: [] };
    const sales = (await daySales(ctx, day.id)).slice(0, Math.min(Number(limit) || 5, 20));
    return {
      sales: sales.map((s) => ({
        receipt_no: s.receipt_no,
        time: timeOf(s.created_at, ctx.settings.timezone),
        total: Number(s.total),
        items: saleSummary(s),
        voided: Boolean(s.voided_at),
      })),
    };
  },

  async find_srs({ query }, ctx) {
    const { data } = await ctx.supabase.from("srs").select("name,company,phone,visit_days,note").order("name");
    const found = ((data ?? []) as Sr[]).filter((s) => matches(String(query ?? ""), s.name, s.company, s.phone));
    return { count: found.length, srs: found.slice(0, 15) };
  },

  async propose_quick_sale({ total, note }, ctx) {
    if (!pos(total)) return { error: "total must be above zero" };
    if (!(await openDay(ctx))) return { error: "The shop is closed. Ask whether to open it first (propose_open_shop)." };
    ctx.proposals.push({ kind: "quick_sale", total: money2(Number(total)), note: note ? String(note) : undefined });
    return { status: "Shown to the user as a card. Nothing is saved until they tap confirm." };
  },

  async propose_item_sale({ items, discount_taka, note }, ctx) {
    if (!(await openDay(ctx))) return { error: "The shop is closed. Ask whether to open it first (propose_open_shop)." };
    if (!Array.isArray(items) || !items.length) return { error: "items is empty" };
    const all = await products(ctx);
    const lines: SaleLine[] = [];
    for (const it of items as Record<string, unknown>[]) {
      const p = all.find((x) => x.id === it.product_id && x.active);
      if (!p) return { error: `Unknown product_id ${String(it.product_id)}. Use search_products first.` };
      const price = Number(p.sell_price);
      if (pos(it.amount_taka)) {
        if (!(price > 0)) return { error: `${p.name} has no price, so it can't be sold by taka amount` };
        const amount = money2(Number(it.amount_taka));
        lines.push({ product_id: p.id, name: p.name_bn || p.name, unit: p.unit, price, amount, line_total: amount });
      } else if (pos(it.qty)) {
        const qty = Math.round(Number(it.qty) * 1000) / 1000;
        lines.push({ product_id: p.id, name: p.name_bn || p.name, unit: p.unit, price, qty, line_total: money2(price * qty) });
      } else return { error: `Give qty or amount_taka for ${p.name}` };
    }
    const sub = lines.reduce((a, l) => a + l.line_total, 0);
    const discount = Math.min(pos(discount_taka) ? Number(discount_taka) : 0, sub);
    ctx.proposals.push({
      kind: "item_sale",
      lines,
      discount,
      total: money2(sub - discount),
      note: note ? String(note) : undefined,
    });
    return { status: "Shown to the user as a card. Nothing is saved until they tap confirm.", total: money2(sub - discount) };
  },

  async propose_product_update(args, ctx) {
    const p = (await products(ctx)).find((x) => x.id === args.product_id);
    if (!p) return { error: "Unknown product_id. Use search_products first." };
    const before: ProductFields = {
      name: p.name,
      name_bn: p.name_bn,
      short_code: p.short_code,
      category: p.category,
      is_favorite: p.is_favorite,
      sell_price: Number(p.sell_price),
      stock_qty: Number(p.stock_qty),
      low_stock_at: p.low_stock_at === null ? null : Number(p.low_stock_at),
    };
    const after = { ...before };
    const text = (v: unknown) => (typeof v === "string" ? v.trim() : undefined);
    if (text(args.new_name)) after.name = text(args.new_name)!;
    if (text(args.new_name_bn) !== undefined) after.name_bn = text(args.new_name_bn) || null;
    if (text(args.new_category) !== undefined) after.category = text(args.new_category) || null;
    if (typeof args.favourite === "boolean") after.is_favorite = args.favourite;
    if (text(args.new_short_code) !== undefined) {
      const code = text(args.new_short_code)!.toLowerCase() || null;
      const all = await products(ctx);
      if (code && all.some((x) => x.id !== p.id && x.short_code?.toLowerCase() === code))
        return { error: `The short code ${code} is already used by another product` };
      after.short_code = code;
    }
    if (typeof args.new_price === "number" && args.new_price >= 0) after.sell_price = money2(args.new_price);
    if (typeof args.set_stock === "number") after.stock_qty = args.set_stock;
    if (typeof args.add_stock === "number") after.stock_qty = Math.round((after.stock_qty + args.add_stock) * 1000) / 1000;
    if (typeof args.low_stock_warning === "number" && args.low_stock_warning >= 0) after.low_stock_at = args.low_stock_warning;
    if (JSON.stringify(before) === JSON.stringify(after)) return { error: "Nothing to change" };
    ctx.proposals.push({ kind: "update_product", product_id: p.id, name: p.name_bn || p.name, unit: p.unit, before, after });
    return { status: "Shown to the user as a card. Nothing is saved until they tap confirm." };
  },

  async propose_new_product(args, ctx) {
    const name = String(args.name ?? "").trim();
    const unit = String(args.unit ?? "pcs") as Unit;
    if (!name) return { error: "name is required (in English)" };
    if (!UNITS.includes(unit)) return { error: `unit must be one of ${UNITS.join(", ")}` };
    if (!(typeof args.sell_price === "number" && args.sell_price >= 0)) return { error: "sell_price is required" };
    if ((await products(ctx)).some((p) => p.name.toLowerCase() === name.toLowerCase()))
      return { error: `A product named ${name} already exists` };
    ctx.proposals.push({
      kind: "new_product",
      product: {
        name,
        name_bn: args.name_bn ? String(args.name_bn).trim() : null,
        unit,
        sell_price: money2(args.sell_price),
        stock_qty: typeof args.stock === "number" ? args.stock : 0,
        category: args.category ? String(args.category).trim() : null,
      },
    });
    return { status: "Shown to the user as a card. Nothing is saved until they tap confirm." };
  },

  async propose_new_sr(args, ctx) {
    const name = String(args.name ?? "").trim();
    const phone = toAsciiDigits(String(args.phone ?? "")).trim();
    if (!name) return { error: "name is required" };
    if (phone.replace(/\D/g, "").length < 5) return { error: "a phone number is required" };
    ctx.proposals.push({
      kind: "new_sr",
      sr: {
        name,
        phone,
        company: args.company ? String(args.company).trim() : null,
        note: args.note ? String(args.note).trim() : null,
      },
    });
    return { status: "Shown to the user as a card. Nothing is saved until they tap confirm." };
  },

  async propose_open_shop(_, ctx) {
    if (await openDay(ctx)) return { error: "The shop is already open" };
    ctx.proposals.push({ kind: "open_shop" });
    return { status: "Shown to the user as a card. Nothing is saved until they tap confirm." };
  },

  async propose_close_shop(_, ctx) {
    const day = await openDay(ctx);
    if (!day) return { error: "The shop is not open" };
    const { total, count } = await dayTotal(ctx, day.id);
    ctx.proposals.push({ kind: "close_shop", total, count });
    return { status: "Shown to the user as a card. Nothing is saved until they tap confirm." };
  },

  async propose_void_sale({ receipt_no }, ctx) {
    const day = await openDay(ctx);
    if (!day) return { error: "The shop is not open; only today's sales can be voided here" };
    const sale = (await daySales(ctx, day.id)).find((s) => s.receipt_no === Number(receipt_no));
    if (!sale) return { error: `No sale #${receipt_no} today. Use recent_sales to find it.` };
    if (sale.voided_at) return { error: `Sale #${receipt_no} is already voided` };
    ctx.proposals.push({
      kind: "void_sale",
      sale_id: sale.id,
      receipt_no: sale.receipt_no,
      total: Number(sale.total),
      summary: saleSummary(sale),
    });
    return { status: "Shown to the user as a card. Nothing is saved until they tap confirm." };
  },
};

async function runTool(call: FunctionCall, ctx: Ctx): Promise<Result> {
  const handler = call.name ? handlers[call.name] : undefined;
  if (!handler) return { error: `Unknown tool ${call.name}` };
  try {
    return await handler((call.args ?? {}) as Record<string, unknown>, ctx);
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/* ---------------- the conversation ---------------- */
function systemPrompt(ctx: Ctx, isOpen: boolean) {
  const now = new Date();
  const date = now.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: ctx.settings.timezone,
  });
  const language = ctx.lang === "bn" ? "Bangla (use Bangla digits)" : "English";
  return `You are the assistant inside "Dokan", the sales app of ${ctx.settings.shop_name}, a small neighbourhood grocery shop in Bangladesh.
You are helping ${ctx.me.name}, the ${ctx.me.role === "owner" ? "owner" : "shop staff"}.
It is ${date}, ${timeOf(now.toISOString(), ctx.settings.timezone)}. The shop is ${isOpen ? "open" : "closed"}.
Every sale is paid in cash; there are no payment methods. Money is in taka (৳).

Reply in ${language} unless the person writes in the other language. Keep replies short: one to three plain sentences, no markdown.

How to work:
- Questions: use the read tools (search_products, today_summary, low_stock, recent_sales, find_srs) and answer from their results only.
- Any change (a sale, a price or stock change, a new product or SR, opening or closing the shop, voiding a sale) must go through the matching propose_ tool. The app shows it as a card and nothing is saved until the person taps confirm. When the request is clear, call the propose_ tool right away without asking permission first. Only say you prepared something after the propose_ tool returned success; then say in one short line what you prepared and ask them to check and confirm. Never claim something is saved or done.
- If any item in a request is unclear or not found, ask about it first and prepare the whole sale together once it is clear.
- Before selling or changing a product, call search_products to get its product_id. Never invent product ids, prices or stock. If a name could mean several products, ask which one. If nothing matches, say so and offer to add the product or record the amount as a total-only sale.
- Quantities: আধা কেজি = 0.5 kg, দেড় কেজি = 1.5 kg, এক পোয়া = 0.25 kg, ২৫০ গ্রাম = 0.25 kg, এক হালি = 4 pieces (or 1 if the product's unit is hali), এক ডজন = 12 pieces (or 1 if the unit is dozen). Convert to the product's own unit.
- "১০ টাকার চিনি" means selling by money: use amount_taka, not qty. "১০০ টাকার বিক্রি" with no product means a total-only sale (propose_quick_sale).
- If a tool returns an error, explain it simply. Staff cannot change past days, settings, or the buying price.`;
}

/** Plain text history only; consecutive turns from the same side are merged. */
function toContents(history: ChatTurn[]): Content[] {
  const turns: ChatTurn[] = [];
  for (const t of history.slice(-MAX_HISTORY)) {
    const text = t.text.trim();
    if (!text) continue;
    const last = turns[turns.length - 1];
    if (last && last.role === t.role) last.text += "\n" + text;
    else turns.push({ role: t.role, text });
  }
  while (turns.length && turns[0].role !== "user") turns.shift();
  return turns.map((t) => ({ role: t.role, parts: [{ text: t.text }] }));
}

const retryable = (e: unknown) => e instanceof ApiError && [404, 429, 500, 503].includes(e.status);
// Google puts the details in the error text: which limit was hit, and when to retry
const isDailyLimit = (e: unknown) => e instanceof ApiError && e.status === 429 && /PerDay/i.test(e.message);
const retryAfterMs = (e: unknown) => {
  const m = e instanceof ApiError ? /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(e.message) : null;
  return m ? Number(m[1]) * 1000 : 2000;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runAssistant(history: ChatTurn[], base: Omit<Ctx, "proposals">) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new AssistantError("config");
  const ai = new GoogleGenAI({ apiKey });
  const ctx: Ctx = { ...base, proposals: [] };
  const contents = toContents(history);
  const config = {
    systemInstruction: systemPrompt(ctx, Boolean(await openDay(ctx))),
    tools: [{ functionDeclarations: TOOLS }],
  };

  const generate = (model: string) => ai.models.generateContent({ model, contents, config });

  // The first model that answers handles the whole turn (switching mid-turn would lose Gemini's context)
  let model: string | null = null;
  let lastError: unknown;
  for (let step = 0; step < MAX_STEPS; step++) {
    let res;
    if (!model) {
      // Every model busy or over its per-minute limit: wait as Google asks (up to 15 s) and go round once more
      for (let round = 0; round < 2 && !res; round++) {
        let shortestWait = Infinity;
        for (const candidate of MODELS) {
          try {
            res = await generate(candidate);
            model = candidate;
            break;
          } catch (e) {
            lastError = e;
            if (!retryable(e)) throw new AssistantError("failed");
            if (!isDailyLimit(e)) shortestWait = Math.min(shortestWait, retryAfterMs(e));
          }
        }
        if (res || round > 0 || shortestWait > 15000) break;
        await sleep(shortestWait + 300);
      }
    } else {
      // Mid-turn: if the model is briefly over its limit, wait as Google asks (up to 15 s) and retry once
      for (let attempt = 0; attempt < 2 && !res; attempt++) {
        try {
          res = await generate(model);
        } catch (e) {
          lastError = e;
          if (!retryable(e) || isDailyLimit(e)) break;
          const wait = retryAfterMs(e);
          if (attempt > 0 || wait > 15000) break;
          await sleep(wait + 300);
        }
      }
    }
    if (!res) throw new AssistantError(isDailyLimit(lastError) ? "quota" : "busy");

    const calls = res.functionCalls ?? [];
    if (!calls.length) return { reply: (res.text ?? "").trim(), proposals: ctx.proposals };

    // Keep the model's own turn as-is (it carries the context Gemini needs), then answer every call
    const modelTurn = res.candidates?.[0]?.content;
    if (modelTurn) contents.push(modelTurn);
    const results = await Promise.all(calls.map((c) => runTool(c, ctx)));
    contents.push({
      role: "user",
      parts: calls.map((c, i) => ({ functionResponse: { id: c.id, name: c.name, response: results[i] } })),
    });
  }
  return { reply: "", proposals: ctx.proposals };
}
