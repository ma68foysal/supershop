/** hali = 4 pieces, the usual way eggs and bananas are sold */
export type Unit = "pcs" | "kg" | "g" | "L" | "ml" | "pack" | "dozen" | "hali";
export const UNITS: Unit[] = ["pcs", "kg", "g", "L", "ml", "pack", "hali", "dozen"];

export type Settings = {
  shop_name: string;
  address: string | null;
  phone: string | null;
  timezone: string;
  open_time: string; // "08:00:00"
  close_time: string;
  auto_open: boolean;
  auto_close: boolean;
};

export type Staff = {
  id: string;
  name: string;
  role: "owner" | "cashier";
  active: boolean;
};

export type Product = {
  id: string;
  name: string;
  name_bn: string | null;
  short_code: string | null;
  category: string | null;
  unit: Unit;
  sell_price: number;
  cost_price: number | null;
  stock_qty: number;
  low_stock_at: number | null;
  is_favorite: boolean;
  active: boolean;
  sr_id: string | null;
};

/** A company sales representative who takes the shop's orders */
export type Sr = {
  id: string;
  name: string;
  company: string | null;
  phone: string;
  /** 0 = Sunday … 6 = Saturday */
  visit_days: number[];
  note: string | null;
};

export type BusinessDay = {
  id: string;
  day_date: string; // "2026-10-05"
  status: "open" | "closed";
  opened_at: string;
  opened_by: string | null;
  closed_at: string | null;
  closed_by: string | null;
  close_type: "manual" | "auto" | null;
  opening_cash: number;
  counted_cash: number | null;
};

export type SaleItem = {
  id: string;
  product_id: string | null;
  name: string;
  unit: Unit;
  qty: number;
  unit_price: number;
  line_total: number;
};

export type Sale = {
  id: string;
  receipt_no: number;
  kind: "quick" | "items";
  subtotal: number;
  discount: number;
  total: number;
  note: string | null;
  created_at: string;
  created_by: string | null;
  voided_at: string | null;
  void_reason: string | null;
  sale_items: SaleItem[];
};

export type ActionResult = { error?: string; message?: string };
