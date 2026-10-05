-- Dokan — Supabase schema (draft v1)
-- Run in Supabase SQL editor. Review before running on production.

create extension if not exists pgcrypto;

-- ---------- settings (single row) ----------
create table public.settings (
  id            int primary key default 1 check (id = 1),
  shop_name     text not null default 'My Shop',
  address       text,
  phone         text,
  currency      text not null default 'BDT',
  timezone      text not null default 'Asia/Dhaka',
  open_time     time not null default '08:00',
  close_time    time not null default '22:00',
  auto_open     boolean not null default false,
  auto_close    boolean not null default true,
  updated_at    timestamptz not null default now()
);
insert into public.settings (id) values (1);

-- ---------- staff ----------
create type public.staff_role as enum ('owner', 'cashier');

create table public.staff (
  id         uuid primary key references auth.users(id) on delete cascade,
  name       text not null,
  role       public.staff_role not null default 'cashier',
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from staff where id = auth.uid() and active);
$$;

create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from staff where id = auth.uid() and active and role = 'owner');
$$;

-- ---------- catalogue ----------
create table public.categories (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  sort       int not null default 0
);

create type public.unit as enum ('pcs', 'kg', 'g', 'L', 'ml', 'pack', 'dozen');

create table public.products (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  name_bn       text,
  short_code    text unique,
  category_id   uuid references public.categories(id) on delete set null,
  unit          public.unit not null default 'pcs',
  sell_price    numeric(12,2) not null check (sell_price >= 0),
  cost_price    numeric(12,2) check (cost_price >= 0),
  stock_qty     numeric(10,3) not null default 0,
  low_stock_at  numeric(10,3),
  is_favorite   boolean not null default false,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index products_name_idx on public.products using gin (to_tsvector('simple', name || ' ' || coalesce(name_bn,'') || ' ' || coalesce(short_code,'')));

-- ---------- business days ----------
create type public.day_status as enum ('open', 'closed');
create type public.close_type as enum ('manual', 'auto');

create table public.business_days (
  id            uuid primary key default gen_random_uuid(),
  day_date      date not null,
  status        public.day_status not null default 'open',
  opened_at     timestamptz not null default now(),
  opened_by     uuid references public.staff(id),
  closed_at     timestamptz,
  closed_by     uuid references public.staff(id),
  close_type    public.close_type,
  opening_cash  numeric(12,2) default 0,
  counted_cash  numeric(12,2),
  summary       jsonb,          -- frozen totals at close
  pdf_path      text,           -- storage path of generated report
  next_receipt  int not null default 1
);
-- only one open day at a time
create unique index one_open_day on public.business_days ((status)) where status = 'open';
create index business_days_date_idx on public.business_days (day_date desc);

-- ---------- sales ----------
create type public.sale_kind as enum ('quick', 'items');
create type public.pay_method as enum ('cash', 'bkash', 'nagad', 'card', 'due');

create table public.sales (
  id               uuid primary key default gen_random_uuid(),
  business_day_id  uuid not null references public.business_days(id),
  receipt_no       int not null,
  kind             public.sale_kind not null,
  subtotal         numeric(12,2) not null,
  discount         numeric(12,2) not null default 0,
  total            numeric(12,2) not null check (total >= 0),
  payment_method   public.pay_method not null default 'cash',
  note             text,
  created_by       uuid references public.staff(id),
  created_at       timestamptz not null default now(),
  voided_at        timestamptz,
  voided_by        uuid references public.staff(id),
  void_reason      text,
  unique (business_day_id, receipt_no)
);
create index sales_day_idx on public.sales (business_day_id, created_at);

create table public.sale_items (
  id          uuid primary key default gen_random_uuid(),
  sale_id     uuid not null references public.sales(id) on delete cascade,
  product_id  uuid references public.products(id) on delete set null,
  name        text not null,           -- snapshot
  unit        public.unit not null,
  qty         numeric(10,3) not null check (qty > 0),
  unit_price  numeric(12,2) not null,  -- snapshot
  line_total  numeric(12,2) not null
);
create index sale_items_sale_idx on public.sale_items (sale_id);

-- ---------- functions ----------
create or replace function public.open_day(p_opening_cash numeric default 0, p_auto boolean default false)
returns public.business_days
language plpgsql security definer set search_path = public as $$
declare d business_days; tz text;
begin
  -- p_auto is only for pg_cron (no API JWT); API callers must be staff
  if p_auto and coalesce(auth.role(), '') <> '' then raise exception 'not allowed'; end if;
  if not p_auto and not is_staff() then raise exception 'not allowed'; end if;
  select timezone into tz from settings where id = 1;
  insert into business_days (day_date, opened_by, opening_cash)
  values ((now() at time zone tz)::date, case when p_auto then null else auth.uid() end, p_opening_cash)
  returning * into d;
  return d;
exception when unique_violation then
  raise exception 'The shop is already open';
end $$;

create or replace function public.close_day(p_counted_cash numeric default null, p_auto boolean default false)
returns public.business_days
language plpgsql security definer set search_path = public as $$
declare d business_days;
begin
  -- p_auto is only for pg_cron (no API JWT); API callers must be staff
  if p_auto and coalesce(auth.role(), '') <> '' then raise exception 'not allowed'; end if;
  if not p_auto and not is_staff() then raise exception 'not allowed'; end if;
  select * into d from business_days where status = 'open' for update;
  if not found then raise exception 'The shop is not open'; end if;

  update business_days set
    status = 'closed',
    closed_at = now(),
    closed_by = case when p_auto then null else auth.uid() end,
    close_type = case when p_auto then 'auto'::close_type else 'manual'::close_type end,
    counted_cash = p_counted_cash,
    summary = day_summary(d.id)
  where id = d.id
  returning * into d;
  return d;
end $$;

-- payload: {kind, discount, payment_method, note, total (quick only), items:[{product_id, qty}]}
create or replace function public.create_sale(payload jsonb)
returns public.sales
language plpgsql security definer set search_path = public as $$
declare
  d business_days; s sales; it jsonb; p products;
  v_sub numeric(12,2) := 0; v_disc numeric(12,2) := coalesce((payload->>'discount')::numeric, 0);
begin
  if not is_staff() then raise exception 'not allowed'; end if;
  select * into d from business_days where status = 'open' for update;
  if not found then raise exception 'Shop is closed — open the shop to start selling'; end if;

  if payload->>'kind' = 'quick' then
    v_sub := (payload->>'total')::numeric;
  else
    for it in select * from jsonb_array_elements(payload->'items') loop
      select * into p from products where id = (it->>'product_id')::uuid and active;
      if not found then raise exception 'Product not found'; end if;
      v_sub := v_sub + round(p.sell_price * (it->>'qty')::numeric, 2);
    end loop;
  end if;

  insert into sales (business_day_id, receipt_no, kind, subtotal, discount, total, payment_method, note, created_by)
  values (d.id, d.next_receipt, (payload->>'kind')::sale_kind, v_sub, v_disc,
          greatest(v_sub - v_disc, 0), coalesce(payload->>'payment_method','cash')::pay_method,
          payload->>'note', auth.uid())
  returning * into s;

  update business_days set next_receipt = next_receipt + 1 where id = d.id;

  if payload->>'kind' = 'items' then
    for it in select * from jsonb_array_elements(payload->'items') loop
      select * into p from products where id = (it->>'product_id')::uuid;
      insert into sale_items (sale_id, product_id, name, unit, qty, unit_price, line_total)
      values (s.id, p.id, p.name, p.unit, (it->>'qty')::numeric, p.sell_price,
              round(p.sell_price * (it->>'qty')::numeric, 2));
      update products set stock_qty = stock_qty - (it->>'qty')::numeric, updated_at = now() where id = p.id;
    end loop;
  end if;
  return s;
end $$;

create or replace function public.day_summary(p_day uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  with s as (select * from sales where business_day_id = p_day and voided_at is null)
  select jsonb_build_object(
    'total',      coalesce((select sum(total) from s), 0),
    'sales',      (select count(*) from s),
    'discount',   coalesce((select sum(discount) from s), 0),
    'voids',      (select count(*) from sales where business_day_id = p_day and voided_at is not null),
    'by_payment', coalesce((select jsonb_object_agg(payment_method, amt) from
                     (select payment_method, sum(total) amt from s group by 1) x), '{}'::jsonb),
    'quick_total',coalesce((select sum(total) from s where kind = 'quick'), 0),
    'top_items',  coalesce((select jsonb_agg(t) from
                     (select si.name, sum(si.qty) qty, sum(si.line_total) amount
                        from sale_items si join s on s.id = si.sale_id
                       group by si.name order by amount desc limit 10) t), '[]'::jsonb)
  );
$$;

-- ---------- row level security ----------
alter table public.settings      enable row level security;
alter table public.staff         enable row level security;
alter table public.categories    enable row level security;
alter table public.products      enable row level security;
alter table public.business_days enable row level security;
alter table public.sales         enable row level security;
alter table public.sale_items    enable row level security;

create policy "staff read"  on public.settings      for select using (is_staff());
create policy "owner write" on public.settings      for update using (is_owner());
create policy "staff read"  on public.staff         for select using (is_staff());
create policy "owner all"   on public.staff         for all    using (is_owner());
create policy "staff read"  on public.categories    for select using (is_staff());
create policy "owner all"   on public.categories    for all    using (is_owner());
create policy "staff read"  on public.products      for select using (is_staff());
create policy "owner all"   on public.products      for all    using (is_owner());
create policy "staff read"  on public.business_days for select using (is_staff());
create policy "staff read"  on public.sales         for select using (is_staff());
create policy "owner void"  on public.sales         for update using (is_owner());
create policy "staff read"  on public.sale_items    for select using (is_staff());
-- inserts into business_days / sales / sale_items go through the functions above.

-- ---------- auto open / close (Supabase → Database → Extensions → pg_cron) ----------
-- create extension if not exists pg_cron;
-- select cron.schedule('dokan-auto-open-close', '*/5 * * * *', $$
--   do $do$
--   declare st settings; local_now time;
--   begin
--     select * into st from settings where id = 1;
--     local_now := (now() at time zone st.timezone)::time;
--     if st.auto_close and local_now >= st.close_time
--        and exists (select 1 from business_days where status = 'open') then
--       perform close_day(null, true);
--     elsif st.auto_open and local_now >= st.open_time and local_now < st.close_time
--        and not exists (select 1 from business_days where status = 'open')
--        and not exists (select 1 from business_days
--                        where day_date = (now() at time zone st.timezone)::date) then
--       perform open_day(0, true);
--     end if;
--   end $do$;
-- $$);
