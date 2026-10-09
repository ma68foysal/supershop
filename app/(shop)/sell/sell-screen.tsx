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
/** A cart line is either a quantity (2 pcs, 0.5 kg) or a taka amount ("৳10 of sugar"). */
type Line = { qty: number } | { amount: number };
const QUICK_AMOUNTS = [5, 10, 20, 30, 50, 100];
const lineTotal = (p: Product, l: Line) => ("amount" in l ? l.amount : Math.round(p.sell_price * l.qty * 100) / 100);
const lineQty = (p: Product, l: Line) => ("amount" in l ? (p.sell_price > 0 ? l.amount / p.sell_price : 0) : l.qty);

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
  const [cart, setCart] = useState<Record<string, Line>>({});
  const [q, setQ] = useState("");
  const hasFav = products.some((p) => p.is_favorite);
  // Category filter; null = the default (Favourites if any, else All)
  const [cat, setCat] = useState<string | null>(null);
  const current = cat ?? (hasFav ? FAV : ALL);
  const [open, setOpen] = useState(false);
  const [discount, setDiscount] = useState("");
  const [picking, setPicking] = useState<Product | null>(null);

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
    .map(([id, line]) => ({ p: byId.get(id)!, line }))
    .filter((l) => l.p);
  const subtotal = lines.reduce((a, l) => a + lineTotal(l.p, l.line), 0);
  const disc = Math.min(Number(discount || 0), subtotal);
  const total = subtotal - disc;

  const setLine = (id: string, line: Line | null) =>
    setCart((c) => {
      const n = { ...c };
      if (!line) delete n[id];
      else n[id] = line;
      return n;
    });
  const setQty = (id: string, qty: number) => setLine(id, qty > 0 ? { qty: Math.round(qty * 1000) / 1000 } : null);
  const setAmount = (id: string, amount: number) => setLine(id, amount > 0 ? { amount } : null);
  const add = (p: Product) => {
    const l = cart[p.id];
    setQty(p.id, (l && "qty" in l ? l.qty : 0) + qtyStep(p.unit));
  };
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
          const l = cart[p.id];
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
              <button
                className={"add amt" + (l && "amount" in l ? " in" : "")}
                onClick={() => setPicking(p)}
                aria-label={t.byAmountAria(p.name)}
              >
                ৳{l && "amount" in l ? <span className="count">{f.num(l.amount)}</span> : null}
              </button>
              <button
                className={"add" + (l && "qty" in l ? " in" : "")}
                onClick={() => add(p)}
                aria-label={t.addItem(p.name)}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                {l && "qty" in l ? <span className="count">{f.num(l.qty)}</span> : null}
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

      {picking && (
        <AmountPicker
          product={picking}
          name={names(picking).main}
          onPick={(amount) => {
            setAmount(picking.id, amount);
            setPicking(null);
          }}
          onClose={() => setPicking(null)}
        />
      )}

      {open && lines.length > 0 && (
        <Sheet title={t.cart} onClose={() => setOpen(false)}>
          <ul className="rows" style={{ marginTop: 10 }}>
            {lines.map(({ p, line }) => (
              <li className="row" key={p.id}>
                <div className="row-main">
                  <div className="row-name">{names(p).main}</div>
                  <div className="row-meta">
                    {"amount" in line ? (
                      <>≈ {f.qty(lineQty(p, line), p.unit)}</>
                    ) : (
                      <>
                        {f.money(p.sell_price)} {t.perUnit(f.unit(p.unit))}
                      </>
                    )}
                  </div>
                  <button
                    className="mode-link"
                    onClick={() =>
                      "amount" in line
                        ? setQty(p.id, qtyStep(p.unit))
                        : setAmount(p.id, Math.round(lineTotal(p, line)) || 10)
                    }
                  >
                    {"amount" in line ? t.switchToQty : t.switchToAmount}
                  </button>
                </div>
                {"amount" in line ? (
                  <div className="stepper amount-box">
                    <span aria-hidden="true">৳</span>
                    <input
                      inputMode="decimal"
                      aria-label={t.byAmountAria(p.name)}
                      value={line.amount || ""}
                      onChange={(e) => {
                        const v = toAsciiDigits(e.target.value).replace(/[^\d.]/g, "");
                        setCart((c) => ({ ...c, [p.id]: { amount: v === "" ? 0 : Number(v) } }));
                      }}
                      onBlur={() => setAmount(p.id, line.amount)}
                    />
                  </div>
                ) : (
                  <div className="stepper">
                    <button aria-label={t.less(p.name)} onClick={() => setQty(p.id, line.qty - qtyStep(p.unit))}>
                      −
                    </button>
                    <input
                      inputMode="decimal"
                      aria-label={t.qtyOf(p.name, f.unit(p.unit))}
                      value={line.qty}
                      onChange={(e) => {
                        const v = toAsciiDigits(e.target.value).replace(/[^\d.]/g, "");
                        setCart((c) => ({ ...c, [p.id]: { qty: v === "" ? 0 : Number(v) } }));
                      }}
                      onBlur={() => setQty(p.id, line.qty)}
                    />
                    <button aria-label={t.more(p.name)} onClick={() => setQty(p.id, line.qty + qtyStep(p.unit))}>
                      +
                    </button>
                  </div>
                )}
                <div className="row-price num" style={{ minWidth: 64 }}>
                  {f.money(lineTotal(p, line))}
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
            disabled={disabled || lines.some((l) => !(lineTotal(l.p, l.line) > 0))}
            onClick={() =>
              onSave(
                {
                  kind: "items",
                  items: lines.map(({ p, line }) =>
                    "amount" in line ? { product_id: p.id, amount: line.amount } : { product_id: p.id, qty: line.qty },
                  ),
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

/** "How much sugar?": quick taka amounts, or type any amount. */
function AmountPicker({
  product: p,
  name,
  onPick,
  onClose,
}: {
  product: Product;
  name: string;
  onPick: (amount: number) => void;
  onClose: () => void;
}) {
  const { t, f } = useI18n();
  const [custom, setCustom] = useState("");
  const value = Number(custom || 0);
  return (
    <Sheet title={t.sellByAmountTitle(name)} onClose={onClose}>
      <p className="sub">
        {f.money(p.sell_price)} {t.perUnit(f.unit(p.unit))}
      </p>
      <div className="amount-chips">
        {QUICK_AMOUNTS.map((a) => (
          <button key={a} className="amount-chip" onClick={() => onPick(a)}>
            <span className="num">{f.money(a)}</span>
            {p.sell_price > 0 && <small>≈ {f.qty(a / p.sell_price, p.unit)}</small>}
          </button>
        ))}
      </div>
      <label className="field">
        <span>{t.otherAmount}</span>
        <input
          inputMode="decimal"
          value={custom}
          onChange={(e) => setCustom(toAsciiDigits(e.target.value).replace(/[^\d.]/g, ""))}
          placeholder={f.digits(15)}
        />
      </label>
      {value > 0 && p.sell_price > 0 && (
        <p className="sub" style={{ marginTop: 6 }}>
          ≈ {f.qty(value / p.sell_price, p.unit)}
        </p>
      )}
      <button className="primary" disabled={!(value > 0)} onClick={() => onPick(value)}>
        {value > 0 ? t.addAmount(f.money(value)) : t.addToCart}
      </button>
    </Sheet>
  );
}
