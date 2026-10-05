"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { saveProduct } from "@/app/actions";
import { Spinner, useReportBusy } from "@/components/busy";
import { useI18n } from "@/components/i18n";
import Sheet from "@/components/sheet";
import { useToast } from "@/components/toast";
import { toAsciiDigits } from "@/lib/format";
import { UNITS, type Product } from "@/lib/types";

const isLow = (p: Product) => p.low_stock_at !== null && Number(p.stock_qty) <= Number(p.low_stock_at);

export default function ProductsScreen({ products, canEdit }: { products: Product[]; canEdit: boolean }) {
  const { t, f, lang } = useI18n();
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
    const s = toAsciiDigits(q.trim().toLowerCase());
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
          placeholder={t.searchProducts}
          aria-label={t.searchProducts}
        />
        {canEdit && (
          <button className="btn-small" onClick={() => setEditing("new")}>
            {t.addProduct}
          </button>
        )}
      </div>
      <p className="sub" style={{ margin: "12px 0 6px" }}>
        {t.productsCount(f.num(products.length))}
        {low > 0 && (
          <>
            ,{" "}
            <button className="low" style={{ textDecoration: "underline" }} onClick={() => setLowOnly(!lowOnly)}>
              {lowOnly ? t.showAll : t.runningLow(f.num(low))}
            </button>
          </>
        )}
        {!canEdit && <>. {t.ownerOnlyProductsNote}</>}
      </p>

      <ul className="rows">
        {list.map((p) => {
          const main = lang === "bn" && p.name_bn ? p.name_bn : p.name;
          const other = lang === "bn" && p.name_bn ? p.name : p.name_bn;
          return (
            <li key={p.id}>
              <button
                className="row"
                style={{ width: "100%", textAlign: "left", opacity: p.active ? 1 : 0.5 }}
                onClick={() => canEdit && setEditing(p)}
                disabled={!canEdit}
              >
                <div className="row-main">
                  <div className="row-name">
                    {main} {other && <span className="bn">{other}</span>}
                    {!p.active && <span className="tag">{t.hidden}</span>}
                    {p.is_favorite && <span className="tag">{t.favourite}</span>}
                  </div>
                  <div className="row-meta">
                    {[p.category, p.short_code && t.code(p.short_code)].filter(Boolean).join(", ")}
                    {p.category || p.short_code ? ", " : ""}
                    <span className={isLow(p) ? "low" : ""}>{t.inStock(f.qty(Number(p.stock_qty), p.unit))}</span>
                  </div>
                </div>
                <div className="row-price num">
                  {f.money(p.sell_price)}
                  <small>{t.perUnit(f.unit(p.unit))}</small>
                </div>
              </button>
            </li>
          );
        })}
        {!list.length && (
          <li className="row">
            <div className="row-main">
              <div className="row-name">{products.length ? t.nothingMatches(q) : t.noProductsYet}</div>
              <div className="row-meta">{canEdit ? t.addHintOwner : t.addHintStaff}</div>
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
  const { t, f } = useI18n();
  const [state, action, pending] = useActionState(saveProduct, {});
  useReportBusy(pending);
  const toast = useToast();
  useEffect(() => {
    if (state.message) {
      toast(state.message);
      onClose();
    }
  }, [state, toast, onClose]);

  return (
    <Sheet title={p ? t.editProduct : t.addProduct} onClose={onClose}>
      <form action={action}>
        {p && <input type="hidden" name="id" value={p.id} />}
        <label className="field">
          <span>{t.fName}</span>
          <input name="name" defaultValue={p?.name} placeholder={t.fNamePh} required />
        </label>
        <label className="field">
          <span>{t.fNameBn}</span>
          <input name="name_bn" defaultValue={p?.name_bn ?? ""} placeholder="সরিষার তেল" />
        </label>
        <div className="two">
          <label className="field">
            <span>{t.fSell}</span>
            <input name="sell_price" inputMode="decimal" defaultValue={p?.sell_price ?? ""} required />
          </label>
          <label className="field">
            <span>{t.fUnit}</span>
            <select name="unit" defaultValue={p?.unit ?? "pcs"}>
              {UNITS.map((u) => (
                <option key={u} value={u}>
                  {t.units[u]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="two">
          <label className="field">
            <span>{t.fCategory}</span>
            <input name="category" list="cats" defaultValue={p?.category ?? ""} placeholder={t.fCategoryPh} />
            <datalist id="cats">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </label>
          <label className="field">
            <span>{t.fCode}</span>
            <input name="short_code" defaultValue={p?.short_code ?? ""} placeholder={t.fCodePh} autoCapitalize="none" />
          </label>
        </div>
        <div className="two">
          <label className="field">
            <span>{t.fStock}</span>
            <input name="stock_qty" inputMode="decimal" defaultValue={p?.stock_qty ?? ""} placeholder={f.digits(0)} />
          </label>
          <label className="field">
            <span>{t.fLow}</span>
            <input name="low_stock_at" inputMode="decimal" defaultValue={p?.low_stock_at ?? ""} placeholder={t.fLowPh} />
          </label>
        </div>
        <label className="field">
          <span>{t.fCost}</span>
          <input name="cost_price" inputMode="decimal" defaultValue={p?.cost_price ?? ""} />
        </label>
        <label className="check">
          <span>{t.fFav}</span>
          <input type="checkbox" name="is_favorite" defaultChecked={p?.is_favorite ?? false} />
        </label>
        {p && (
          <label className="check">
            <span>{t.fHide}</span>
            <input type="checkbox" name="active" value="off" defaultChecked={!p.active} />
          </label>
        )}
        {state.error && <p className="error">{state.error}</p>}
        <button className="primary" disabled={pending}>
          {pending ? (
            <>
              <Spinner />
              {t.saving}
            </>
          ) : (
            t.saveProduct
          )}
        </button>
      </form>
    </Sheet>
  );
}
