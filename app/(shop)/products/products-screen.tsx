"use client";

import { useActionState, useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { deleteProduct, saveProduct } from "@/app/actions";
import { Spinner, useReportBusy } from "@/components/busy";
import ConfirmDialog from "@/components/confirm-dialog";
import { useI18n } from "@/components/i18n";
import Sheet from "@/components/sheet";
import { useToast } from "@/components/toast";
import { telHref } from "@/lib/format";
import { fuzzyFilter } from "@/lib/search";
import { UNITS, type Product, type Sr } from "@/lib/types";

const isLow = (p: Product) => p.low_stock_at !== null && Number(p.stock_qty) <= Number(p.low_stock_at);

export default function ProductsScreen({
  products,
  srs,
}: {
  products: Product[];
  srs: Sr[];
}) {
  const { t, f, lang } = useI18n();
  const [q, setQ] = useState("");
  const [lowOnly, setLowOnly] = useState(false);
  const [editing, setEditing] = useState<Product | "new" | null>(null);

  const categories = useMemo(
    () => [...new Set(products.map((p) => p.category).filter(Boolean) as string[])].sort(),
    [products],
  );
  const low = products.filter((p) => p.active && isLow(p)).length;
  const list = fuzzyFilter(
    products.filter((p) => !lowOnly || (p.active && isLow(p))),
    q,
    (p) => [p.name, p.name_bn, p.short_code, p.category],
  );

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
        <button className="btn-small" onClick={() => setEditing("new")}>
          {t.addProduct}
        </button>
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
      </p>

      <ul className="rows">
        {list.map((p) => {
          const main = lang === "bn" && p.name_bn ? p.name_bn : p.name;
          const other = lang === "bn" && p.name_bn ? p.name : p.name_bn;
          // Running low and we know who brings it: offer a one-tap call
          const sr = p.active && isLow(p) && p.sr_id ? srs.find((s) => s.id === p.sr_id) : undefined;
          return (
            <li key={p.id} style={sr ? { borderBottom: "1px solid var(--rule)" } : undefined}>
              <button
                className="row"
                style={{
                  width: "100%",
                  textAlign: "left",
                  opacity: p.active ? 1 : 0.5,
                  borderBottom: sr ? 0 : undefined,
                }}
                onClick={() => setEditing(p)}
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
              {sr && (
                <a className="low-call" href={telHref(sr.phone)}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                    <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" />
                  </svg>
                  {t.lowCallSr(sr.company ? `${sr.name} (${sr.company})` : sr.name)}
                </a>
              )}
            </li>
          );
        })}
        {!list.length && (
          <li className="row">
            <div className="row-main">
              <div className="row-name">{products.length ? t.nothingMatches(q) : t.noProductsYet}</div>
              <div className="row-meta">{t.addHintOwner}</div>
            </div>
          </li>
        )}
      </ul>

      {editing && (
        <ProductForm
          product={editing === "new" ? null : editing}
          categories={categories}
          srs={srs}
          onClose={() => setEditing(null)}
        />
      )}
    </main>
  );
}

function ProductForm({
  product: p,
  categories,
  srs,
  onClose,
}: {
  product: Product | null;
  categories: string[];
  srs: Sr[];
  onClose: () => void;
}) {
  const { t, f } = useI18n();
  const [state, action, pending] = useActionState(saveProduct, {});
  useReportBusy(pending);
  const toast = useToast();
  const [asking, setAsking] = useState(false);
  const stopAsking = useCallback(() => setAsking(false), []);
  const [deleting, startDelete] = useTransition();
  useReportBusy(deleting);
  const remove = () =>
    startDelete(async () => {
      const r = await deleteProduct(p!.id, p!.name);
      if (r.error) return toast(r.error, true);
      toast(r.message ?? "");
      setAsking(false);
      onClose();
    });
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
          <span>{t.fSr}</span>
          <select name="sr_id" defaultValue={p?.sr_id ?? ""}>
            <option value="">{t.noSr}</option>
            {srs.map((s) => (
              <option key={s.id} value={s.id}>
                {s.company ? `${s.name} (${s.company})` : s.name}
              </option>
            ))}
          </select>
        </label>
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
        {p && (
          <button type="button" className="secondary" style={{ color: "var(--khata)", borderColor: "var(--khata)" }} onClick={() => setAsking(true)}>
            {t.deleteProduct}
          </button>
        )}
      </form>
      {asking && p && (
        <ConfirmDialog
          tone="danger"
          title={t.deleteProductTitle}
          body={t.deleteProductBody}
          subject={{ label: p.name_bn || p.name, amount: f.money(p.sell_price) }}
          confirmLabel={t.yesDelete}
          pendingLabel={t.deleting}
          pending={deleting}
          onConfirm={remove}
          onCancel={stopAsking}
        />
      )}
    </Sheet>
  );
}
