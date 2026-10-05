"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminClient, createClient } from "@/lib/supabase/server";
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
const fail = (e: { message: string } | null | undefined, fallback = "Something went wrong. Try again.") => ({
  error: e?.message ?? fallback,
});

// ---------- auth ----------
export async function signIn(_: ActionResult, form: FormData): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: toEmail(String(form.get("login") ?? "")),
    password: String(form.get("password") ?? ""),
  });
  if (error) return { error: "Wrong username or password" };
  redirect("/sell");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

// ---------- business day ----------
export async function openDay(): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("open_day", { p_opening_cash: 0 });
  return error ? fail(error) : done("Shop opened");
}

export async function closeDay(countedCash: number | null): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("close_day", { p_counted_cash: countedCash });
  return error ? fail(error) : done("Shop closed. Today's report is ready");
}

// ---------- sales ----------
export type SalePayload =
  | { kind: "quick"; total: number; note?: string }
  | { kind: "items"; items: { product_id: string; qty: number }[]; discount?: number; note?: string };

export async function createSale(payload: SalePayload): Promise<ActionResult & { total?: number }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_sale", { payload });
  if (error) return fail(error);
  revalidatePath("/", "layout");
  return { total: Number(data.total), message: `Sale #${data.receipt_no} saved` };
}

export async function voidSale(saleId: string, reason: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("void_sale", { p_sale: saleId, p_reason: reason });
  return error ? fail(error) : done("Sale voided");
}

// ---------- products ----------
const numOrNull = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").trim();
  return s === "" ? null : Number(s);
};
const textOrNull = (v: FormDataEntryValue | null) => String(v ?? "").trim() || null;

export async function saveProduct(_: ActionResult, form: FormData): Promise<ActionResult> {
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
    active: form.get("active") !== "off",
    updated_at: new Date().toISOString(),
  };
  if (!row.name) return { error: "Add a product name" };
  if (row.sell_price === null || Number.isNaN(row.sell_price) || row.sell_price < 0)
    return { error: "Add a sell price" };

  const supabase = await createClient();
  const { error } = id
    ? await supabase.from("products").update(row).eq("id", id)
    : await supabase.from("products").insert(row);
  if (error?.code === "23505") return { error: `The short code "${row.short_code}" is already used` };
  if (error?.code === "42501") return { error: "Only the owner can change products" };
  return error ? fail(error) : done(`Product saved: ${row.name}`);
}

// ---------- settings ----------
export async function saveSettings(_: ActionResult, form: FormData): Promise<ActionResult> {
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
  if (error) return fail(error);
  if (!count) return { error: "Only the owner can change settings" };
  return done("Settings saved");
}

// ---------- staff ----------
export async function addStaff(_: ActionResult, form: FormData): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: isOwner } = await supabase.rpc("is_owner");
  if (!isOwner) return { error: "Only the owner can add staff" };

  const name = String(form.get("name") ?? "").trim();
  const username = String(form.get("username") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  if (!name) return { error: "Add the person's name" };
  if (!/^[a-z0-9._-]{3,30}$/.test(username))
    return { error: "Username needs 3–30 letters or numbers, no spaces" };
  if (password.length < 6) return { error: "Password needs at least 6 characters" };

  try {
    const admin = createAdminClient();
    const { error } = await admin.auth.admin.createUser({
      email: toEmail(username),
      password,
      email_confirm: true,
      user_metadata: { name },
    });
    if (error) return { error: error.message.includes("already") ? "That username is taken" : error.message };
  } catch (e) {
    return { error: (e as Error).message };
  }
  return done(`${name} can now sign in as "${username}"`);
}

export async function setStaffActive(id: string, active: boolean): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("staff").update({ active }).eq("id", id);
  return error ? fail(error) : done(active ? "Staff member can sign in again" : "Staff member can no longer sign in");
}

export async function renameMe(_: ActionResult, form: FormData): Promise<ActionResult> {
  const supabase = await createClient();
  const name = String(form.get("name") ?? "").trim();
  if (!name) return { error: "Add a name" };
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // Staff can only update via owner policy; owners rename themselves here.
  const { error, count } = await supabase.from("staff").update({ name }, { count: "exact" }).eq("id", user!.id);
  if (error) return fail(error);
  if (!count) return { error: "Ask the owner to change your name" };
  return done("Name saved");
}
