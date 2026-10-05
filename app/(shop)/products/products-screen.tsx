"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { saveProduct } from "@/app/actions";
import Sheet from "@/components/sheet";
import { useToast } from "@/components/toast";
import { money, qtyLabel, unitLabel } from "@/lib/format";
import { UNITS, type Product } from "@/lib/types";

const isLow = (p: Product) => p.low_stock_at !== null && Number(p.stock_qty) <= Number(p.low_stock_at);

export default function ProductsScreen({ products, canEdit }: { products: Product[]; canEdit: boolean }) {
  const [q, setQ] = useState("");
  const [lowOnly, setLowOnly] = useState(false);
  const [editing, setEditing] = useState<Product | "new" | null>(null);

  const categories = useMemo(
    () => [...new Set(products.map((p) => p.category).filter(Boolean) as string[])].sort(),
    [products],
  );
  const low = products.filter((p) => p.active && isLow(p)).length;
  const list = products.filter((p) => {
    if (lowOnly && !(p.active && isLow(p))) return false;
    const s = q.trim().toLowerCase();
    return !s || [p.name, p.name_bn, p.short_code, p.category].some((v) => v?.toLowerCase().includes(s));
  });

  return (
    <main className="main">
      <div style={{ display: "flex", gap: 8 }}>
        <input
          className="search"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search products"
          aria-label="Search products"
        />
        {canEdit && (
          <button className="btn-small" onClick={() => setEditing("new")}>
            Add product
          </button>
        )}
      </div>
      <p className="sub" style={{ margin: "12px 0 6px" }}>
        {products.length} products
        {low > 0 && (
          <>
            ,{" "}
            <button className="low" style={{ textDecoration: "underline" }} onClick={() => setLowOnly(!lowOnly)}>
              {lowOnly ? "show all" : `${low} running low`}
            </button>
          </>
        )}
        {!canEdit && ". Only the owner can change products."}
      </p>

      <ul className="rows">
        {list.map((p) => (
          <li key={p.id}>
            <button
              className="row"
              style={{ width: "100%", textAlign: "left", opacity: p.active ? 1 : 0.5 }}
              onClick={() => canEdit && setEditing(p)}
              disabled={!canEdit}
            >
              <div className="row-main">
                <div className="row-name">
                  {p.name} {p.name_bn && <span className="bn">{p.name_bn}</span>}
                  {!p.active && <span className="tag">Hidden</span>}
                  {p.is_favorite && <span className="tag">Favourite</span>}
                </div>
                <div className="row-meta">
                  {[p.category, p.short_code && `code ${p.short_code}`].filter(Boolean).join(", ")}
                  {p.category || p.short_code ? ", " : ""}
                  <span className={isLow(p) ? "low" : ""}>{qtyLabel(Number(p.stock_qty), p.unit)} in stock</span>
                </div>
              </div>
              <div className="row-price num">
                {money(p.sell_price)}
                <small>per {unitLabel(p.unit)}</small>
              </div>
            </button>
          </li>
        ))}
        {!list.length && (
          <li className="row">
            <div className="row-main">
              <div className="row-name">{products.length ? `Nothing matches “${q}”` : "No products yet"}</div>
              <div className="row-meta">
                {canEdit ? "Tap Add product to add the things you sell." : "Ask the owner to add products."}
              </div>
            </div>
          </li>
        )}
      </ul>

      {editing && (
        <ProductForm
          product={editing === "new" ? null : editing}
          categories={categories}
          onClose={() => setEditing(null)}
        />
      )}
    </main>
  );
}

function ProductForm({
  product: p,
  categories,
  onClose,
}: {
  product: Product | null;
  categories: string[];
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState(saveProduct, {});
  const toast = useToast();
  useEffect(() => {
    if (state.message) {
      toast(state.message);
      onClose();
    }
  }, [state, toast, onClose]);

  return (
    <Sheet title={p ? "Edit product" : "Add product"} onClose={onClose}>
      <form action={action}>
        {p && <input type="hidden" name="id" value={p.id} />}
        <label className="field">
          <span>Name (English, printed on the PDF)</span>
          <input name="name" defaultValue={p?.name} placeholder="e.g. Mustard oil 500 ml" required />
        </label>
        <label className="field">
          <span>Name in Bangla (optional)</span>
          <input name="name_bn" defaultValue={p?.name_bn ?? ""} placeholder="সরিষার তেল" />
        </label>
        <div className="two">
          <label className="field">
            <span>Sell price (৳)</span>
            <input name="sell_price" inputMode="decimal" defaultValue={p?.sell_price ?? ""} required />
          </label>
          <label className="field">
            <span>Sold by</span>
            <select name="unit" defaultValue={p?.unit ?? "pcs"}>
              {UNITS.map((u) => (
                <option key={u.value} value={u.value}>
                  {u.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="two">
          <label className="field">
            <span>Category</span>
            <input name="category" list="cats" defaultValue={p?.category ?? ""} placeholder="e.g. Oil" />
            <datalist id="cats">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </label>
          <label className="field">
            <span>Short code</span>
            <input name="short_code" defaultValue={p?.short_code ?? ""} placeholder="e.g. oil1" autoCapitalize="none" />
          </label>
        </div>
        <div className="two">
          <label className="field">
            <span>Stock now</span>
            <input name="stock_qty" inputMode="decimal" defaultValue={p?.stock_qty ?? ""} placeholder="0" />
          </label>
          <label className="field">
            <span>Warn when stock is at</span>
            <input name="low_stock_at" inputMode="decimal" defaultValue={p?.low_stock_at ?? ""} placeholder="e.g. 5" />
          </label>
        </div>
        <label className="field">
          <span>Buying price (৳, optional)</span>
          <input name="cost_price" inputMode="decimal" defaultValue={p?.cost_price ?? ""} />
        </label>
        <label className="check">
          <span>Show in Favourites on the Sell screen</span>
          <input type="checkbox" name="is_favorite" defaultChecked={p?.is_favorite ?? false} />
        </label>
        {p && (
          <label className="check">
            <span>Hide this product from the Sell screen</span>
            <input type="checkbox" name="active" value="off" defaultChecked={!p.active} />
          </label>
        )}
        {state.error && <p className="error">{state.error}</p>}
        <button className="primary" disabled={pending}>
          {pending ? "Saving…" : "Save product"}
        </button>
      </form>
    </Sheet>
  );
}
