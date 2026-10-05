# Dokan — shop sales recorder (project plan)

A phone-first web app for a neighbourhood grocery. It records every sale with no
barcode scanner, opens and closes the "business day", and produces a PDF report
for each day that compares against previous days.

Stack: **Next.js (App Router) + Supabase (Postgres, Auth, Storage, pg_cron) + Vercel.**
Currency assumed **BDT (৳)**, timezone **Asia/Dhaka** — both are settings.

---

## 1. What the app must do

| Need (from the brief) | How the app handles it |
|---|---|
| Anyone can run it, also from a phone | Mobile-first PWA (installable to home screen), big tap targets, 4 bottom tabs. Staff sign in with a 4-digit PIN; owner with email. |
| Record a sale by **total only** ("sold ৳100") | **Quick sale** tab: number pad → payment method → Save. One record, no items. |
| Record a sale **item by item** like a super shop | **Item sale**: search or tap favourite products, adjust qty (supports 0.5 kg, 250 g), discount, Charge. Stock goes down automatically. |
| Products added manually (no scanner) | Products screen: name (English + optional Bangla), category, unit (pcs/kg/g/L/pack), sell price, cost price, stock, short code (e.g. `soap1`) for fast search. |
| Opening / closing times | Settings: scheduled open & close time + auto on/off. Manual **Open shop / Close shop** button always available and overrides the schedule. |
| At closing, all-day sales as a PDF | Closing a day freezes its totals, generates the PDF, stores it in Supabase Storage. |
| See / download / share old PDFs | Reports tab: list of every day with total and change vs previous day; View, Download, Share (Web Share API → WhatsApp, Messenger, email). |
| Compare with previous day and tell the result | PDF + Reports show: vs previous day, vs same weekday last week, 7-day average; top items; payment split; "up 12% on yesterday" sentence. |

### Other super-shop features worth having (phased)
- **Phase 1 (launch):** products, both sale modes, open/close, daily PDF, reports list, receipt share, void a sale (with reason), payment methods (Cash, bKash, Nagad, Card).
- **Phase 2:** stock-in (purchases from suppliers), low-stock list, profit per day (uses cost price), **due/baki khata** (customer credit ledger — very common in local groceries), expenses (rent, bills) so the PDF shows net.
- **Phase 3:** offline mode (queue sales in IndexedDB, sync later), Bluetooth thermal receipt printer, monthly report, multiple staff permissions.

---

## 2. Core concept: the business day

Every sale belongs to a **business day** row, not to a calendar date. This
handles shops that close after midnight and makes reports trivial.

```
 Open shop (manual or 8:00 auto)        Close shop (manual or 22:00 auto)
        │                                          │
        ▼                                          ▼
 business_days.status = 'open'  ──sales──▶  status = 'closed'
                                               totals frozen (jsonb)
                                               PDF generated → Storage
```

Rules
- Only one day can be open at a time (unique partial index).
- Trying to sell while closed shows "Shop is closed — Open shop to start selling".
- Auto open/close runs from **Supabase pg_cron** every minute-check (or every 5 min) against `settings`. Vercel Hobby cron runs only once a day, so pg_cron is the better place. The PDF for auto-closed days is generated the first time someone opens the report (or by a Vercel cron at night).
- Manual close asks for counted cash (optional) → shows cash difference in the PDF.

---

## 3. Database (Supabase / Postgres)

Full SQL is in [`supabase-schema.sql`](./supabase-schema.sql). Tables:

| Table | Purpose |
|---|---|
| `settings` | one row: shop name, address, phone, open/close time, auto flags, currency, timezone |
| `staff` | linked to `auth.users`; name, role (`owner` / `cashier`), active |
| `categories` | Oil, Soap, Rice, Snacks… |
| `products` | name, name_bn, short_code, unit, sell_price, cost_price, stock_qty, low_stock_at, is_favorite, active |
| `business_days` | date, opened_at/by, closed_at/by, close_type (manual/auto), opening_cash, counted_cash, status, summary jsonb, pdf_path |
| `sales` | business_day_id, receipt_no, kind (`quick`/`items`), subtotal, discount, total, payment_method, note, voided |
| `sale_items` | sale_id, product_id, **name & price snapshot**, qty, unit, line_total |

Money is `numeric(12,2)`; quantity is `numeric(10,3)` so 0.250 kg works.

Database functions (called via `supabase.rpc`) keep things atomic:
- `open_day()` / `close_day(counted_cash)` — enforce one open day, freeze summary.
- `create_sale(payload jsonb)` — inserts sale + items + decrements stock in one transaction, assigns next receipt number for the day.
- `day_summary(day_id)` — totals, count, by payment, by category, top 10 items, comparisons.

Security: Row Level Security on every table; only signed-in staff can read/write;
only `owner` can edit products, settings, or void sales.

---

## 4. App structure (Next.js App Router)

```
app/
  (auth)/login/page.tsx            PIN pad / email login
  (shop)/layout.tsx                bottom tab bar + shop-status strip
  (shop)/sell/page.tsx             Quick total ⇄ Item by item toggle
  (shop)/today/page.tsx            live day: total, sales list, Close shop
  (shop)/reports/page.tsx          all days, comparisons, PDF actions
  (shop)/reports/[dayId]/page.tsx  day detail + PDF preview
  (shop)/products/page.tsx         list, search, add/edit sheet
  (shop)/settings/page.tsx         shop info, timings, staff
  api/reports/[dayId]/pdf/route.ts generates / returns PDF
  manifest.ts                      PWA manifest
lib/
  supabase/{client,server}.ts      @supabase/ssr helpers
  money.ts  dates.ts  summary.ts
components/
  keypad.tsx  cart.tsx  product-tile.tsx  status-strip.tsx  ...
```

Libraries
- `@supabase/supabase-js` + `@supabase/ssr` — auth cookies in server components.
- Tailwind CSS — design tokens from the prototype go into the theme.
- `@react-pdf/renderer` — builds the daily PDF in a route handler on Vercel.
- `zod` — validate sale payloads.
- `serwist` (or `next-pwa` successor) — installable PWA, later offline.

### PDF and Bangla text — one decision needed
`@react-pdf/renderer` is light and runs fine on Vercel, but it does **not shape
Bangla conjuncts correctly**. Options:
1. Print product names in English in the PDF (Bangla can still show in the app). Simplest. **Recommended for launch.**
2. Render the report as an HTML page and convert with headless Chrome (`puppeteer-core` + `@sparticuz/chromium`) — perfect Bangla, heavier function and slower cold start.

### Sharing
`navigator.share({ files: [pdfFile] })` opens the phone's share sheet
(WhatsApp etc.). Desktop falls back to Download + "Copy link" (a signed
Supabase Storage URL that expires after 7 days).

---

## 5. Daily PDF layout

1. Header: shop name, address, date, opened 8:02 AM by Rahim, closed 10:05 PM (auto).
2. Result box: **Total ৳18,420 — up 12% on Sunday (৳16,450)**, vs last Monday, vs 7-day average.
3. Summary: number of sales, average sale, items sold, discounts, voids, cash / bKash / Nagad / card split, counted cash vs expected.
4. Top 10 items by amount.
5. Full sales list: time, receipt no, items (or "Quick sale"), payment, amount.
6. Footer: generated time, page x of y.

---

## 6. Build order

1. Supabase project → run `supabase-schema.sql` → create owner user.
2. Next.js: Supabase helpers, login, protected `(shop)` layout.
3. Products CRUD (needed before item sales).
4. Open / close day + status strip.
5. Quick sale, then Item sale with cart + `create_sale` RPC.
6. Today screen (live list, void).
7. Summary function + PDF route + Reports list with share/download.
8. Settings (timings, staff PINs) + pg_cron auto open/close.
9. PWA manifest, icons, test on real phones, deploy to Vercel.

## 7. Environment variables (Vercel + `.env.local`)
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=      # server only — PDF route & cron
```
