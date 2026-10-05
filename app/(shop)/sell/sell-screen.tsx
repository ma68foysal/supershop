"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { createSale, type SalePayload } from "@/app/actions";
import { Spinner, useReportBusy } from "@/components/busy";
import { useI18n } from "@/components/i18n";
import Sheet from "@/components/sheet";
import { useToast } from "@/components/toast";
import { qtyStep, toAsciiDigits } from "@/lib/format";
import type { Product } from "@/lib/types";

export type Mode = "quick" | "items";
const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "00", "0", "del"];
// Ids for the built-in category chips; can't clash with a typed category name
const FAV = "\u0000fav";
const ALL = "\u0000all";

export default function SellScreen({
  products,
  isOpen,
  initialMode,
}: {
  products: Product[];
  isOpen: boolean;
  initialMode: Mode;
}) {
  const { t, f } = useI18n();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [pending, start] = useTransition();
  useReportBusy(pending);
  const toast = useToast();

  // Each phone remembers the mode it was last used in
  const pick = (m: Mode) => {
    setMode(m);
    document.cookie = `sell-mode=${m}; path=/; max-age=31536000; samesite=lax`;
  };

  const save = (payload: SalePayload, after: () => void) =>
    start(async () => {
      const r = await createSale(payload);
      if (r.error) return toast(r.error, true);
      toast(t.saleSaved(f.digits(r.receiptNo ?? 0), f.money(r.total ?? 0)));
      after();
    });

  return (
    <main className={"main" + (mode === "items" ? " with-bar" : "")}>
      {!isOpen && (
        <p className="notice" style={{ marginBottom: 14 }}>
          {t.shopClosedNotice}
        </p>
      )}
      <div className="seg" role="group" aria-label={t.howToRecord}>
        <button aria-pressed={mode === "quick"} onClick={() => pick("quick")}>
          {t.totalOnly}
        </button>
        <button aria-pressed={mode === "items"} onClick={() => pick("items")}>
          {t.itemByItem}
        </button>
      </div>
      {/* Both stay mounted so switching modes keeps the cart and the typed amount */}
      <div hidden={mode !== "quick"}>
        <QuickSale active={mode === "quick"} disabled={!isOpen || pending} saving={pending} onSave={save} />
      </div>
      <div hidden={mode !== "items"}>
        <ItemSale products={products} disabled={!isOpen || pending} saving={pending} onSave={save} />
      </div>
    </main>
  );
}

/* ---------------- total only ---------------- */
function QuickSale({
  active,
  disabled,
  saving,
  onSave,
}: {
  active: boolean;
  disabled: boolean;
  saving: boolean;
  onSave: (p: SalePayload, after: () => void) => void;
}) {
  const { t, f } = useI18n();
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");

  const press = (k: string) => {
    if (k === "del") return setAmount((a) => a.slice(0, -1));
    setAmount((a) => (a.length >= 7 || (a === "" && k.startsWith("0")) ? a : a + k));
  };

  // Typing on a hardware keyboard works too, in English or Bangla digits
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === "INPUT") return;
      const k = toAsciiDigits(e.key);
      if (/^\d$/.test(k)) press(k);
      if (e.key === "Backspace") press("del");
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [active]);

  const value = Number(amount || 0);
  return (
    <>
      <div className="ledger">
        <div className="ledger-label">{t.amountReceived}</div>
        <div className={"ledger-amount" + (amount ? "" : " empty")} aria-live="polite">
          <span className="tk">৳</span>
          <span>{f.num(value)}</span>
        </div>
      </div>
      <div className="keypad">
        {KEYS.map((k) => (
          <button
            key={k}
            className={"key" + (k === "del" ? " fn" : "")}
            onClick={() => press(k)}
            aria-label={k === "del" ? t.deleteDigit : f.digits(k)}
          >
            {k === "del" ? (
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 5H9l-6 7 6 7h12z" />
                <path d="m17 9-6 6M11 9l6 6" />
              </svg>
            ) : (
              f.digits(k)
            )}
          </button>
        ))}
      </div>
      <input
        className="input"
        style={{ marginTop: 12 }}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder={t.notePlaceholder}
        aria-label={t.note}
      />
      <button
        className="primary"
        disabled={disabled || !value}
        onClick={() =>
          onSave({ kind: "quick", total: value, note }, () => {
            setAmount("");
            setNote("");
          })
        }
      >
        {saving ? (
          <>
            <Spinner />
            {t.savingAmount(f.money(value))}
          </>
        ) : value ? (
          t.saveSaleOf(f.money(value))
        ) : (
          t.saveSale
        )}
      </button>
    </>
  );
}

/* ---------------- item by item ---------------- */
function ItemSale({
  products,
  disabled,
  saving,
  onSave,
}: {
  products: Product[];
  disabled: boolean;
  saving: boolean;
  onSave: (p: SalePayload, after: () => void) => void;
}) {
  const { t, f, lang } = useI18n();
  const [cart, setCart] = useState<Record<string, number>>({});
  const [q, setQ] = useState("");
  const hasFav = products.some((p) => p.is_favorite);
  // Category filter; null = the default (Favourites if any, else All)
  const [cat, setCat] = useState<string | null>(null);
  const current = cat ?? (hasFav ? FAV : ALL);
  const [open, setOpen] = useState(false);
  const [discount, setDiscount] = useState("");

  const cats = useMemo(
    () => [
      ...(hasFav ? [{ id: FAV, label: t.favourites }] : []),
      { id: ALL, label: t.all },
      ...[...new Set(products.map((p) => p.category).filter(Boolean) as string[])]
        .sort()
        .map((c) => ({ id: c, label: c })),
    ],
    [products, hasFav, t],
  );

  const list = useMemo(() => {
    const s = toAsciiDigits(q.trim().toLowerCase());
    if (s)
      return products.filter((p) =>
        [p.name, p.name_bn, p.short_code].some((v) => v?.toLowerCase().includes(s) || v?.includes(q.trim())),
      );
    if (current === FAV) return products.filter((p) => p.is_favorite);
    if (current === ALL) return products;
    return products.filter((p) => p.category === current);
  }, [products, q, current]);

  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const lines = Object.entries(cart)
    .map(([id, qty]) => ({ p: byId.get(id)!, qty }))
    .filter((l) => l.p);
  const subtotal = lines.reduce((a, l) => a + Math.round(l.p.sell_price * l.qty * 100) / 100, 0);
  const disc = Math.min(Number(discount || 0), subtotal);
  const total = subtotal - disc;

  const setQty = (id: string, qty: number) =>
    setCart((c) => {
      const n = { ...c };
      if (!(qty > 0)) delete n[id];
      else n[id] = Math.round(qty * 1000) / 1000;
      return n;
    });
  const add = (p: Product) => setQty(p.id, (cart[p.id] ?? 0) + qtyStep(p.unit));
  // Bangla screens lead with the Bangla name when there is one
  const names = (p: Product) =>
    lang === "bn" && p.name_bn
      ? { main: p.name_bn, sub: p.name }
      : { main: p.name, sub: p.name_bn || p.category || " " };

  if (!products.length)
    return (
      <p className="notice">
        {t.noProductsA}{" "}
        <Link className="link" href="/products">
          {t.addProductsLink}
        </Link>
        , {t.noProductsB}
      </p>
    );

  return (
    <>
      <input
        className="search"
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t.searchSell}
        aria-label={t.searchProducts}
      />
      {!q && (
        <div className="cats">
          {cats.map((c) => (
            <button key={c.id} className="chip" aria-pressed={current === c.id} onClick={() => setCat(c.id)}>
              {c.label}
            </button>
          ))}
        </div>
      )}
      <ul className="rows" style={{ marginTop: q ? 12 : 0 }}>
        {list.map((p) => {
          const n = cart[p.id];
          return (
            <li className="row" key={p.id}>
              <div className="row-main">
                <div className="row-name">{names(p).main}</div>
                <div className="row-meta">{names(p).sub}</div>
              </div>
              <div className="row-price num">
                {f.money(p.sell_price)}
                <small>{t.perUnit(f.unit(p.unit))}</small>
              </div>
              <button className={"add" + (n ? " in" : "")} onClick={() => add(p)} aria-label={t.addItem(p.name)}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                {n ? <span className="count">{f.num(n)}</span> : null}
              </button>
            </li>
          );
        })}
        {!list.length && (
          <li className="row">
            <div className="row-main">
              <div className="row-name">{t.noMatch(q)}</div>
              <div className="row-meta">{t.noMatchHint}</div>
            </div>
          </li>
        )}
      </ul>

      {lines.length > 0 && (
        <div className="cartbar">
          <div className="info">
            <small>{t.inCart(lines.length, f.num(lines.length))}</small>
            <span className="num">{f.money(subtotal)}</span>
          </div>
          <button onClick={() => setOpen(true)}>{t.reviewCharge}</button>
        </div>
      )}

      {open && lines.length > 0 && (
        <Sheet title={t.cart} onClose={() => setOpen(false)}>
          <ul className="rows" style={{ marginTop: 10 }}>
            {lines.map(({ p, qty }) => (
              <li className="row" key={p.id}>
                <div className="row-main">
                  <div className="row-name">{names(p).main}</div>
                  <div className="row-meta">
                    {f.money(p.sell_price)} {t.perUnit(f.unit(p.unit))}
                  </div>
                </div>
                <div className="stepper">
                  <button aria-label={t.less(p.name)} onClick={() => setQty(p.id, qty - qtyStep(p.unit))}>
                    −
                  </button>
                  <input
                    inputMode="decimal"
                    aria-label={t.qtyOf(p.name, f.unit(p.unit))}
                    value={qty}
                    onChange={(e) => {
                      const v = toAsciiDigits(e.target.value).replace(/[^\d.]/g, "");
                      setCart((c) => ({ ...c, [p.id]: v === "" ? 0 : Number(v) }));
                    }}
                    onBlur={() => setQty(p.id, qty)}
                  />
                  <button aria-label={t.more(p.name)} onClick={() => setQty(p.id, qty + qtyStep(p.unit))}>
                    +
                  </button>
                </div>
                <div className="row-price num" style={{ minWidth: 70 }}>
                  {f.money(Math.round(p.sell_price * qty * 100) / 100)}
                </div>
              </li>
            ))}
          </ul>
          <label className="field">
            <span>{t.discountTk}</span>
            <input
              inputMode="decimal"
              value={discount}
              placeholder={f.digits(0)}
              onChange={(e) => setDiscount(toAsciiDigits(e.target.value).replace(/[^\d.]/g, ""))}
            />
          </label>
          <div className="totals">
            <div>
              <span>{t.subtotal}</span>
              <span className="num">{f.money(subtotal)}</span>
            </div>
            {disc > 0 && (
              <div>
                <span>{t.discount}</span>
                <span className="num">−{f.money(disc)}</span>
              </div>
            )}
            <div className="grand">
              <span>{t.total}</span>
              <span className="num">{f.money(total)}</span>
            </div>
          </div>
          <button
            className="primary"
            disabled={disabled || lines.some((l) => !(l.qty > 0))}
            onClick={() =>
              onSave(
                {
                  kind: "items",
                  items: lines.map((l) => ({ product_id: l.p.id, qty: l.qty })),
                  discount: disc,
                },
                () => {
                  setCart({});
                  setDiscount("");
                  setOpen(false);
                  setQ("");
                },
              )
            }
          >
            {saving ? (
              <>
                <Spinner />
                {t.savingAmount(f.money(total))}
              </>
            ) : (
              t.charge(f.money(total))
            )}
          </button>
          <button
            className="secondary"
            onClick={() => {
              setCart({});
              setOpen(false);
            }}
          >
            {t.clearCart}
          </button>
        </Sheet>
      )}
    </>
  );
}
