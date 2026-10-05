"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { createSale, type SalePayload } from "@/app/actions";
import Sheet from "@/components/sheet";
import { useToast } from "@/components/toast";
import { money, qtyLabel, qtyStep, unitLabel } from "@/lib/format";
import type { Product } from "@/lib/types";

export type Mode = "quick" | "items";
const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "00", "0", "del"];

export default function SellScreen({
  products,
  isOpen,
  initialMode,
}: {
  products: Product[];
  isOpen: boolean;
  initialMode: Mode;
}) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [pending, start] = useTransition();
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
      toast(`${r.message}, ${money(r.total ?? 0)}`);
      after();
    });

  return (
    <main className={"main" + (mode === "items" ? " with-bar" : "")}>
        {!isOpen && (
          <p className="notice" style={{ marginBottom: 14 }}>
            The shop is closed. Tap <b>Open shop</b> at the top to start selling.
          </p>
        )}
        <div className="seg" role="group" aria-label="How to record this sale">
          <button aria-pressed={mode === "quick"} onClick={() => pick("quick")}>
            Total only
          </button>
          <button aria-pressed={mode === "items"} onClick={() => pick("items")}>
            Item by item
          </button>
        </div>
        {/* Both stay mounted so switching modes keeps the cart and the typed amount */}
        <div hidden={mode !== "quick"}>
          <QuickSale active={mode === "quick"} disabled={!isOpen || pending} onSave={save} />
        </div>
        <div hidden={mode !== "items"}>
          <ItemSale products={products} disabled={!isOpen || pending} onSave={save} />
        </div>
    </main>
  );
}

/* ---------------- total only ---------------- */
function QuickSale({
  active,
  disabled,
  onSave,
}: {
  active: boolean;
  disabled: boolean;
  onSave: (p: SalePayload, after: () => void) => void;
}) {
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");

  const press = (k: string) => {
    if (k === "del") return setAmount((a) => a.slice(0, -1));
    setAmount((a) => (a.length >= 7 || (a === "" && k.startsWith("0")) ? a : a + k));
  };

  // Typing on a hardware keyboard works too
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === "INPUT") return;
      if (/^\d$/.test(e.key)) press(e.key);
      if (e.key === "Backspace") press("del");
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [active]);

  const value = Number(amount || 0);
  return (
    <>
      <div className="ledger">
        <div className="ledger-label">Amount received</div>
        <div className={"ledger-amount" + (amount ? "" : " empty")} aria-live="polite">
          <span className="tk">৳</span>
          <span>{value.toLocaleString("en-IN")}</span>
        </div>
      </div>
      <div className="keypad">
        {KEYS.map((k) => (
          <button
            key={k}
            className={"key" + (k === "del" ? " fn" : "")}
            onClick={() => press(k)}
            aria-label={k === "del" ? "Delete last digit" : k}
          >
            {k === "del" ? (
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 5H9l-6 7 6 7h12z" />
                <path d="m17 9-6 6M11 9l6 6" />
              </svg>
            ) : (
              k
            )}
          </button>
        ))}
      </div>
      <input
        className="input"
        style={{ marginTop: 12 }}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Note (optional), e.g. oil, shampoo, soap"
        aria-label="Note"
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
        {value ? `Save sale of ${money(value)}` : "Save sale"}
      </button>
    </>
  );
}

/* ---------------- item by item ---------------- */
function ItemSale({
  products,
  disabled,
  onSave,
}: {
  products: Product[];
  disabled: boolean;
  onSave: (p: SalePayload, after: () => void) => void;
}) {
  const [cart, setCart] = useState<Record<string, number>>({});
  const [q, setQ] = useState("");
  const hasFav = products.some((p) => p.is_favorite);
  const [cat, setCat] = useState(hasFav ? "Favourites" : "All");
  const [open, setOpen] = useState(false);
  const [discount, setDiscount] = useState("");

  const cats = useMemo(
    () => [
      ...(hasFav ? ["Favourites"] : []),
      "All",
      ...[...new Set(products.map((p) => p.category).filter(Boolean) as string[])].sort(),
    ],
    [products, hasFav],
  );

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (s)
      return products.filter((p) =>
        [p.name, p.name_bn, p.short_code].some((v) => v?.toLowerCase().includes(s)),
      );
    if (cat === "Favourites") return products.filter((p) => p.is_favorite);
    if (cat === "All") return products;
    return products.filter((p) => p.category === cat);
  }, [products, q, cat]);

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

  if (!products.length)
    return (
      <p className="notice">
        No products yet. <Link className="link" href="/products">Add products</Link>, or use <b>Total only</b> to record
        the amount.
      </p>
    );

  return (
    <>
      <input
        className="search"
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search name, বাংলা or code"
        aria-label="Search products"
      />
      {!q && (
        <div className="cats">
          {cats.map((c) => (
            <button key={c} className="chip" aria-pressed={cat === c} onClick={() => setCat(c)}>
              {c}
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
                <div className="row-name">{p.name}</div>
                <div className="row-meta">{p.name_bn || p.category || " "}</div>
              </div>
              <div className="row-price num">
                {money(p.sell_price)}
                <small>per {unitLabel(p.unit)}</small>
              </div>
              <button className={"add" + (n ? " in" : "")} onClick={() => add(p)} aria-label={`Add ${p.name}`}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                {n ? <span className="count">{qtyLabel(n, p.unit)}</span> : null}
              </button>
            </li>
          );
        })}
        {!list.length && (
          <li className="row">
            <div className="row-main">
              <div className="row-name">No product matches “{q}”</div>
              <div className="row-meta">Check the spelling, or add it in Products.</div>
            </div>
          </li>
        )}
      </ul>

      {lines.length > 0 && (
        <div className="cartbar">
          <div className="info">
            <small>
              {lines.length} item{lines.length > 1 ? "s" : ""} in cart
            </small>
            <span className="num">{money(subtotal)}</span>
          </div>
          <button onClick={() => setOpen(true)}>Review and charge</button>
        </div>
      )}

      {open && lines.length > 0 && (
        <Sheet title="Cart" onClose={() => setOpen(false)}>
          <ul className="rows" style={{ marginTop: 10 }}>
            {lines.map(({ p, qty }) => (
              <li className="row" key={p.id}>
                <div className="row-main">
                  <div className="row-name">{p.name}</div>
                  <div className="row-meta">
                    {money(p.sell_price)} per {unitLabel(p.unit)}
                  </div>
                </div>
                <div className="stepper">
                  <button aria-label={`Less ${p.name}`} onClick={() => setQty(p.id, qty - qtyStep(p.unit))}>
                    −
                  </button>
                  <input
                    inputMode="decimal"
                    aria-label={`Quantity of ${p.name} in ${unitLabel(p.unit)}`}
                    value={qty}
                    onChange={(e) => {
                      const v = e.target.value.replace(/[^\d.]/g, "");
                      setCart((c) => ({ ...c, [p.id]: v === "" ? 0 : Number(v) }));
                    }}
                    onBlur={() => setQty(p.id, qty)}
                  />
                  <button aria-label={`More ${p.name}`} onClick={() => setQty(p.id, qty + qtyStep(p.unit))}>
                    +
                  </button>
                </div>
                <div className="row-price num" style={{ minWidth: 70 }}>
                  {money(Math.round(p.sell_price * qty * 100) / 100)}
                </div>
              </li>
            ))}
          </ul>
          <label className="field">
            <span>Discount (৳)</span>
            <input
              inputMode="decimal"
              value={discount}
              placeholder="0"
              onChange={(e) => setDiscount(e.target.value.replace(/[^\d.]/g, ""))}
            />
          </label>
          <div className="totals">
            <div>
              <span>Subtotal</span>
              <span className="num">{money(subtotal)}</span>
            </div>
            {disc > 0 && (
              <div>
                <span>Discount</span>
                <span className="num">−{money(disc)}</span>
              </div>
            )}
            <div className="grand">
              <span>Total</span>
              <span className="num">{money(total)}</span>
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
            Charge {money(total)}
          </button>
          <button
            className="secondary"
            onClick={() => {
              setCart({});
              setOpen(false);
            }}
          >
            Clear cart
          </button>
        </Sheet>
      )}
    </>
  );
}
