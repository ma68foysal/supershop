"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { toAsciiDigits, type Lang } from "@/lib/format";
import { LANG_COOKIE, translateDbError, type Dict } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n-server";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import type { Proposal } from "@/lib/assistant/proposals";
import type { ActionResult, Unit } from "@/lib/types";

/** Staff sign in with a short username; it maps to this hidden email domain. */
const STAFF_DOMAIN = "staff.dokan.local";
const toEmail = (login: string) => {
  const v = login.trim().toLowerCase();
  return v.includes("@") ? v : `${v}@${STAFF_DOMAIN}`;
};

const done = (message?: string): ActionResult => {
  revalidatePath("/", "layout");
  return { message };
};
const fail = (t: Dict, e: { message: string } | null | undefined) => ({ error: translateDbError(t, e?.message) });

// ---------- language ----------
export async function setLanguage(lang: Lang) {
  (await cookies()).set(LANG_COOKIE, lang === "en" ? "en" : "bn", {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
  revalidatePath("/", "layout");
}

// ---------- auth ----------
export async function signIn(_: ActionResult, form: FormData): Promise<ActionResult> {
  const { t } = await getI18n();
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: toEmail(String(form.get("login") ?? "")),
    password: String(form.get("password") ?? ""),
  });
  if (error) return { error: t.wrongLogin };
  redirect("/sell");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

// ---------- business day ----------
export async function openDay(): Promise<ActionResult> {
  const { t } = await getI18n();
  const supabase = await createClient();
  const { error } = await supabase.rpc("open_day", { p_opening_cash: 0 });
  return error ? fail(t, error) : done(t.shopOpened);
}

export async function closeDay(countedCash: number | null): Promise<ActionResult> {
  const { t } = await getI18n();
  const supabase = await createClient();
  const { error } = await supabase.rpc("close_day", { p_counted_cash: countedCash });
  return error ? fail(t, error) : done(t.shopClosedReport);
}

// ---------- sales ----------
export type SalePayload =
  | { kind: "quick"; total: number; note?: string }
  | {
      kind: "items";
      /** qty (2 pcs, 0.5 kg) or amount in taka ("৳10 of sugar") */
      items: ({ product_id: string; qty: number } | { product_id: string; amount: number })[];
      discount?: number;
      note?: string;
    };

export async function createSale(payload: SalePayload): Promise<ActionResult & { total?: number; receiptNo?: number }> {
  const { t } = await getI18n();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_sale", { payload });
  if (error) return fail(t, error);
  revalidatePath("/", "layout");
  return { total: Number(data.total), receiptNo: Number(data.receipt_no) };
}

export async function voidSale(saleId: string, reason: string): Promise<ActionResult> {
  const { t } = await getI18n();
  const supabase = await createClient();
  const { error } = await supabase.rpc("void_sale", { p_sale: saleId, p_reason: reason });
  return error ? fail(t, error) : done(t.saleVoided);
}

/** Owner: change a sale. Quick sales: total + note. Item sales: line quantities (by line id), discount, note. */
export type SaleEdit =
  | { total: number; note?: string }
  | { items: { id: string; qty: number }[]; discount?: number; note?: string };

export async function updateSale(saleId: string, edit: SaleEdit): Promise<ActionResult> {
  const { t } = await getI18n();
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_sale", { p_sale: saleId, payload: edit });
  return error ? fail(t, error) : done(t.saleUpdated);
}

export async function deleteSale(saleId: string): Promise<ActionResult> {
  const { t } = await getI18n();
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_sale", { p_sale: saleId });
  return error ? fail(t, error) : done(t.saleDeleted);
}

// ---------- past days (reports) ----------
export async function addSaleToDay(dayId: string, total: number, note: string): Promise<ActionResult> {
  const { t } = await getI18n();
  const supabase = await createClient();
  const { error } = await supabase.rpc("create_sale", { payload: { kind: "quick", total, note, day_id: dayId } });
  return error ? fail(t, error) : done(t.saleAdded);
}

export async function setCountedCash(dayId: string, cash: number | null): Promise<ActionResult> {
  const { t } = await getI18n();
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_counted_cash", { p_day: dayId, p_cash: cash });
  return error ? fail(t, error) : done(t.cashSaved);
}

export async function deleteDay(dayId: string): Promise<ActionResult> {
  const { t } = await getI18n();
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_day", { p_day: dayId });
  return error ? fail(t, error) : done(t.dayDeleted);
}

// ---------- products ----------
const numOrNull = (v: FormDataEntryValue | null) => {
  const s = toAsciiDigits(String(v ?? "")).trim();
  return s === "" ? null : Number(s);
};
const textOrNull = (v: FormDataEntryValue | null) => String(v ?? "").trim() || null;

export async function saveProduct(_: ActionResult, form: FormData): Promise<ActionResult> {
  const { t } = await getI18n();
  const id = textOrNull(form.get("id"));
  const row = {
    name: String(form.get("name") ?? "").trim(),
    name_bn: textOrNull(form.get("name_bn")),
    short_code: textOrNull(form.get("short_code"))?.toLowerCase() ?? null,
    category: textOrNull(form.get("category")),
    unit: String(form.get("unit") ?? "pcs") as Unit,
    sell_price: numOrNull(form.get("sell_price")),
    cost_price: numOrNull(form.get("cost_price")),
    stock_qty: numOrNull(form.get("stock_qty")) ?? 0,
    low_stock_at: numOrNull(form.get("low_stock_at")),
    is_favorite: form.get("is_favorite") === "on",
    sr_id: textOrNull(form.get("sr_id")),
    active: form.get("active") !== "off",
    updated_at: new Date().toISOString(),
  };
  if (!row.name) return { error: t.needProductName };
  if (row.sell_price === null || Number.isNaN(row.sell_price) || row.sell_price < 0) return { error: t.needPrice };

  const supabase = await createClient();
  const { error } = id
    ? await supabase.from("products").update(row).eq("id", id)
    : await supabase.from("products").insert(row);
  if (error?.code === "23505") return { error: t.codeUsed(row.short_code ?? "") };
  if (error?.code === "42501") return { error: t.ownerOnlyProducts };
  return error ? fail(t, error) : done(t.productSaved(row.name));
}

export async function deleteProduct(id: string, name: string): Promise<ActionResult> {
  const { t } = await getI18n();
  const supabase = await createClient();
  const { error, count } = await supabase.from("products").delete({ count: "exact" }).eq("id", id);
  if (error) return fail(t, error);
  if (!count) return { error: t.ownerOnlyProducts };
  return done(t.productDeleted(name));
}

// ---------- company SRs ----------
export async function saveSr(_: ActionResult, form: FormData): Promise<ActionResult> {
  const { t } = await getI18n();
  const id = textOrNull(form.get("id"));
  const row = {
    name: String(form.get("name") ?? "").trim(),
    company: textOrNull(form.get("company")),
    phone: toAsciiDigits(String(form.get("phone") ?? "")).trim(),
    visit_days: form
      .getAll("visit_days")
      .map(Number)
      .filter((d) => d >= 0 && d <= 6),
    note: textOrNull(form.get("note")),
    updated_at: new Date().toISOString(),
  };
  if (!row.name) return { error: t.needSrName };
  if (!/\d{5,}/.test(row.phone.replace(/\D/g, ""))) return { error: t.needPhone };

  const supabase = await createClient();
  const { error, count } = id
    ? await supabase.from("srs").update(row, { count: "exact" }).eq("id", id)
    : await supabase.from("srs").insert(row, { count: "exact" });
  if (error?.code === "42501" || (!error && !count)) return { error: t.ownerOnlySrs };
  return error ? fail(t, error) : done(t.srSaved(row.name));
}

export async function deleteSr(id: string, name: string): Promise<ActionResult> {
  const { t } = await getI18n();
  const supabase = await createClient();
  const { error, count } = await supabase.from("srs").delete({ count: "exact" }).eq("id", id);
  if (error) return fail(t, error);
  if (!count) return { error: t.ownerOnlySrs };
  return done(t.srDeleted(name));
}

// ---------- settings ----------
export async function saveSettings(_: ActionResult, form: FormData): Promise<ActionResult> {
  const { t } = await getI18n();
  const supabase = await createClient();
  const { error, count } = await supabase
    .from("settings")
    .update(
      {
        shop_name: String(form.get("shop_name") ?? "").trim() || "My Shop",
        address: textOrNull(form.get("address")),
        phone: textOrNull(form.get("phone")),
        open_time: String(form.get("open_time") || "08:00"),
        close_time: String(form.get("close_time") || "22:00"),
        auto_open: form.get("auto_open") === "on",
        auto_close: form.get("auto_close") === "on",
        updated_at: new Date().toISOString(),
      },
      { count: "exact" },
    )
    .eq("id", 1);
  if (error) return fail(t, error);
  if (!count) return { error: t.ownerOnlySettings };
  return done(t.settingsSaved);
}

// ---------- staff ----------
export async function addStaff(_: ActionResult, form: FormData): Promise<ActionResult> {
  const { t } = await getI18n();
  const supabase = await createClient();
  const { data: isOwner } = await supabase.rpc("is_owner");
  if (!isOwner) return { error: t.ownerOnlyStaff };

  const name = String(form.get("name") ?? "").trim();
  const username = String(form.get("username") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  if (!name) return { error: t.needStaffName };
  if (!/^[a-z0-9._-]{3,30}$/.test(username)) return { error: t.badUsername };
  if (password.length < 6) return { error: t.shortPassword };

  try {
    const admin = createAdminClient();
    const { error } = await admin.auth.admin.createUser({
      email: toEmail(username),
      password,
      email_confirm: true,
      user_metadata: { name },
    });
    if (error) return { error: error.message.includes("already") ? t.usernameTaken : error.message };
  } catch (e) {
    return { error: (e as Error).message };
  }
  return done(t.staffAdded(name, username));
}

/** Owner only (database rule): give someone the owner's full access, or make them staff again. */
export async function setStaffRole(id: string, name: string, role: "owner" | "cashier"): Promise<ActionResult> {
  const { t } = await getI18n();
  const supabase = await createClient();
  const { error, count } = await supabase.from("staff").update({ role }, { count: "exact" }).eq("id", id);
  if (error) return fail(t, error);
  if (!count) return { error: t.ownerOnlyStaff };
  return done(t.roleChanged(name));
}

export async function setStaffActive(id: string, active: boolean): Promise<ActionResult> {
  const { t } = await getI18n();
  const supabase = await createClient();
  const { error } = await supabase.from("staff").update({ active }).eq("id", id);
  return error ? fail(t, error) : done(active ? t.loginOn : t.loginOff);
}

// ---------- assistant: carry out a confirmed card ----------
/** Runs a change the assistant prepared, after the person tapped confirm. Same permissions as the screens. */
export async function runProposal(p: Proposal): Promise<ActionResult> {
  const { t, f } = await getI18n();
  const supabase = await createClient();
  switch (p.kind) {
    case "quick_sale":
    case "item_sale": {
      const payload =
        p.kind === "quick_sale"
          ? { kind: "quick", total: p.total, note: p.note }
          : {
              kind: "items",
              items: p.lines.map((l) =>
                l.amount ? { product_id: l.product_id, amount: l.amount } : { product_id: l.product_id, qty: l.qty },
              ),
              discount: p.discount,
              note: p.note,
            };
      const { data, error } = await supabase.rpc("create_sale", { payload });
      if (error) return fail(t, error);
      return done(t.saleSaved(f.digits(data.receipt_no), f.money(Number(data.total))));
    }
    case "update_product": {
      const { error, count } = await supabase
        .from("products")
        .update({ ...p.after, updated_at: new Date().toISOString() }, { count: "exact" })
        .eq("id", p.product_id);
      if (error?.code === "23505") return { error: t.codeUsed(p.after.short_code ?? "") };
      if (error) return fail(t, error);
      if (!count) return { error: t.genericError };
      return done(t.productSaved(p.name));
    }
    case "new_product": {
      const { error } = await supabase.from("products").insert(p.product);
      return error ? fail(t, error) : done(t.productSaved(p.product.name_bn || p.product.name));
    }
    case "new_sr": {
      const { error } = await supabase.from("srs").insert(p.sr);
      return error ? fail(t, error) : done(t.srSaved(p.sr.name));
    }
    case "open_shop": {
      const { error } = await supabase.rpc("open_day", { p_opening_cash: 0 });
      return error ? fail(t, error) : done(t.shopOpened);
    }
    case "close_shop": {
      const { error } = await supabase.rpc("close_day", { p_counted_cash: null });
      return error ? fail(t, error) : done(t.shopClosedReport);
    }
    case "void_sale": {
      const { error } = await supabase.rpc("void_sale", { p_sale: p.sale_id, p_reason: "" });
      return error ? fail(t, error) : done(t.saleVoided);
    }
  }
}
