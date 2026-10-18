import type { Unit } from "../types";

/**
 * A change the assistant has prepared. Nothing is saved until the person taps
 * confirm on the card; then `runProposal` (app/actions.ts) carries it out with
 * their own permissions. Prices and names here come from the database, not the AI.
 */
export type SaleLine = {
  product_id: string;
  name: string;
  unit: Unit;
  price: number;
  /** quantity, or a taka amount for "৳10 of sugar" */
  qty?: number;
  amount?: number;
  line_total: number;
};

/** The product fields the assistant may change (never the buying price) */
export type ProductFields = {
  name: string;
  name_bn: string | null;
  short_code: string | null;
  category: string | null;
  is_favorite: boolean;
  sell_price: number;
  stock_qty: number;
  low_stock_at: number | null;
};

export type Proposal =
  | { kind: "quick_sale"; total: number; note?: string }
  | { kind: "item_sale"; lines: SaleLine[]; discount: number; total: number; note?: string }
  | {
      kind: "update_product";
      product_id: string;
      name: string;
      unit: Unit;
      before: ProductFields;
      after: ProductFields;
    }
  | {
      kind: "new_product";
      product: {
        name: string;
        name_bn: string | null;
        unit: Unit;
        sell_price: number;
        stock_qty: number;
        category: string | null;
      };
    }
  | { kind: "new_sr"; sr: { name: string; company: string | null; phone: string; note: string | null } }
  | { kind: "open_shop" }
  | { kind: "close_shop"; total: number; count: number }
  | { kind: "void_sale"; sale_id: string; receipt_no: number; total: number; summary: string; day_date: string }
  | { kind: "delete_sales"; day_date: string; sales: SaleBrief[]; total: number }
  | { kind: "delete_days"; days: { day_id: string; day_date: string; total: number; sales: number }[]; total: number };

export type SaleBrief = { sale_id: string; receipt_no: number; total: number; summary: string };

export type ChatTurn = { role: "user" | "model"; text: string };
