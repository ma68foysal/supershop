-- Dokan — Supabase schema
-- Run once in Supabase → SQL Editor on a new project, then the files in supabase/migrations in order.
-- Every sale is cash in hand: there is no payment-method data.

create extension if not exists pgcrypto;

-- ============ settings (single row) ============
create table public.settings (
  id          int primary key default 1 check (id = 1),
  shop_name   text not null default 'My Shop',
  address     text,
  phone       text,
  timezone    text not null default 'Asia/Dhaka',
  open_time   time not null default '08:00',
  close_time  time not null default '22:00',
  auto_open   boolean not null default false,
  auto_close  boolean not null default true,
  updated_at  timestamptz not null default now()
);
insert into public.settings (id) values (1);

-- ============ staff ============
create type public.staff_role as enum ('owner', 'cashier');

create table public.staff (
  id         uuid primary key references auth.users(id) on delete cascade,
  name       text not null,
  role       public.staff_role not null default 'cashier',
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- The first user created becomes the owner; later users are cashiers.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into staff (id, name, role)
  values (new.id,
          coalesce(nullif(new.raw_user_meta_data->>'name', ''), split_part(new.email, '@', 1)),
          case when exists (select 1 from staff) then 'cashier'::staff_role else 'owner'::staff_role end);
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from staff where id = auth.uid() and active);
$$;

create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from staff where id = auth.uid() and active and role = 'owner');
$$;

-- ============ products ============
-- hali = 4 pieces (eggs, bananas)
create type public.unit as enum ('pcs', 'kg', 'g', 'L', 'ml', 'pack', 'dozen', 'hali');

create table public.products (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  name_bn       text,
  short_code    text,
  category      text,
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
create unique index products_short_code_key on public.products (lower(short_code)) where short_code is not null;

-- ============ business days ============
create type public.day_status as enum ('open', 'closed');
create type public.close_type as enum ('manual', 'auto');

create table public.business_days (
  id            uuid primary key default gen_random_uuid(),
  day_date      date not null,
  status        public.day_status not null default 'open',
  opened_at     timestamptz not null default now(),
  opened_by     uuid references public.staff(id) on delete set null,
  closed_at     timestamptz,
  closed_by     uuid references public.staff(id) on delete set null,
  close_type    public.close_type,
  opening_cash  numeric(12,2) not null default 0,
  counted_cash  numeric(12,2),
  next_receipt  int not null default 1
);
create unique index one_open_day on public.business_days ((status)) where status = 'open';
create index business_days_date_idx on public.business_days (day_date desc, opened_at desc);

-- ============ sales ============
create type public.sale_kind as enum ('quick', 'items');

create table public.sales (
  id               uuid primary key default gen_random_uuid(),
  business_day_id  uuid not null references public.business_days(id) on delete cascade,
  receipt_no       int not null,
  kind             public.sale_kind not null,
  subtotal         numeric(12,2) not null,
  discount         numeric(12,2) not null default 0,
  total            numeric(12,2) not null check (total >= 0),
  note             text,
  created_by       uuid references public.staff(id) on delete set null,
  created_at       timestamptz not null default now(),
  voided_at        timestamptz,
  voided_by        uuid references public.staff(id) on delete set null,
  void_reason      text,
  unique (business_day_id, receipt_no)
);
create index sales_day_idx on public.sales (business_day_id, created_at);

create table public.sale_items (
  id          uuid primary key default gen_random_uuid(),
  sale_id     uuid not null references public.sales(id) on delete cascade,
  product_id  uuid references public.products(id) on delete set null,
  name        text not null,           -- snapshot at time of sale
  unit        public.unit not null,
  qty         numeric(10,3) not null check (qty > 0),
  unit_price  numeric(12,2) not null,  -- snapshot at time of sale
  line_total  numeric(12,2) not null
);
create index sale_items_sale_idx on public.sale_items (sale_id);

-- Live totals per day (voided sales excluded)
create view public.day_totals with (security_invoker = true) as
select d.id as business_day_id,
       coalesce(sum(s.total) filter (where s.voided_at is null), 0)::numeric(12,2) as total,
       count(s.id) filter (where s.voided_at is null) as sales_count
from public.business_days d
left join public.sales s on s.business_day_id = d.id
group by d.id;

-- ============ internal day functions (not callable from the API) ============
create or replace function public._open_day(p_by uuid, p_cash numeric)
returns public.business_days
language plpgsql security definer set search_path = public as $$
declare d business_days; tz text;
begin
  select timezone into tz from settings where id = 1;
  insert into business_days (day_date, opened_by, opening_cash)
  values ((now() at time zone tz)::date, p_by, coalesce(p_cash, 0))
  returning * into d;
  return d;
exception when unique_violation then
  raise exception 'The shop is already open';
end $$;

create or replace function public._close_day(p_by uuid, p_type close_type, p_counted numeric, p_at timestamptz)
returns public.business_days
language plpgsql security definer set search_path = public as $$
declare d business_days;
begin
  update business_days
     set status = 'closed', closed_at = p_at, closed_by = p_by,
         close_type = p_type, counted_cash = p_counted
   where status = 'open'
  returning * into d;
  if not found then raise exception 'The shop is not open'; end if;
  return d;
end $$;

revoke execute on function public._open_day(uuid, numeric) from public, anon, authenticated;
revoke execute on function public._close_day(uuid, close_type, numeric, timestamptz) from public, anon, authenticated;

-- ============ API functions ============
create or replace function public.open_day(p_opening_cash numeric default 0)
returns public.business_days
language plpgsql security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'Not allowed'; end if;
  return _open_day(auth.uid(), p_opening_cash);
end $$;

create or replace function public.close_day(p_counted_cash numeric default null)
returns public.business_days
language plpgsql security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'Not allowed'; end if;
  return _close_day(auth.uid(), 'manual', p_counted_cash, now());
end $$;

-- Applies the automatic opening/closing schedule. Safe to call often:
-- the app calls it on every page load, and pg_cron can call it every few minutes.
-- An automatic close is stamped with the scheduled closing time, even if it runs later.
create or replace function public.auto_tick()
returns text
language plpgsql security definer set search_path = public as $$
declare st settings; d business_days; today date; open_ts timestamptz; close_ts timestamptz;
begin
  -- API callers must be staff; pg_cron runs with no API role
  if coalesce(auth.role(), '') <> '' and not is_staff() then raise exception 'Not allowed'; end if;
  select * into st from settings where id = 1;

  select * into d from business_days where status = 'open' for update;
  if found then
    if st.auto_close then
      close_ts := (d.day_date + st.close_time) at time zone st.timezone;
      if close_ts <= d.opened_at then close_ts := close_ts + interval '1 day'; end if;
      if now() >= close_ts then
        perform _close_day(null, 'auto', null, close_ts);
        return 'closed';
      end if;
    end if;
    return 'open';
  end if;

  if st.auto_open then
    today    := (now() at time zone st.timezone)::date;
    open_ts  := (today + st.open_time)  at time zone st.timezone;
    close_ts := (today + st.close_time) at time zone st.timezone;
    if close_ts <= open_ts then close_ts := close_ts + interval '1 day'; end if;
    if now() >= open_ts and now() < close_ts
       and not exists (select 1 from business_days where day_date = today) then
      perform _open_day(null, 0);
      return 'opened';
    end if;
  end if;
  return 'closed';
end $$;

-- payload: {kind: 'quick'|'items', total (quick), discount, note, items: [{product_id, qty}]}
create or replace function public.create_sale(payload jsonb)
returns public.sales
language plpgsql security definer set search_path = public as $$
declare
  d business_days; s sales; it jsonb; p products; q numeric;
  v_kind sale_kind := (payload->>'kind')::sale_kind;
  v_sub numeric(12,2) := 0;
  v_disc numeric(12,2) := greatest(coalesce((payload->>'discount')::numeric, 0), 0);
begin
  if not is_staff() then raise exception 'Not allowed'; end if;
  select * into d from business_days where status = 'open' for update;
  if not found then raise exception 'The shop is closed. Open the shop to start selling'; end if;

  if v_kind = 'quick' then
    v_sub := (payload->>'total')::numeric;
    if v_sub is null or v_sub <= 0 then raise exception 'Enter an amount above zero'; end if;
  else
    if jsonb_array_length(coalesce(payload->'items', '[]'::jsonb)) = 0 then
      raise exception 'Add at least one item';
    end if;
    for it in select * from jsonb_array_elements(payload->'items') loop
      q := (it->>'qty')::numeric;
      if q is null or q <= 0 then raise exception 'Quantity must be above zero'; end if;
      select * into p from products where id = (it->>'product_id')::uuid and active;
      if not found then raise exception 'A product in the cart no longer exists'; end if;
      v_sub := v_sub + round(p.sell_price * q, 2);
    end loop;
  end if;

  insert into sales (business_day_id, receipt_no, kind, subtotal, discount, total, note, created_by)
  values (d.id, d.next_receipt, v_kind, v_sub, least(v_disc, v_sub), v_sub - least(v_disc, v_sub),
          nullif(trim(payload->>'note'), ''), auth.uid())
  returning * into s;

  update business_days set next_receipt = next_receipt + 1 where id = d.id;

  if v_kind = 'items' then
    for it in select * from jsonb_array_elements(payload->'items') loop
      q := (it->>'qty')::numeric;
      select * into p from products where id = (it->>'product_id')::uuid;
      insert into sale_items (sale_id, product_id, name, unit, qty, unit_price, line_total)
      values (s.id, p.id, p.name, p.unit, q, p.sell_price, round(p.sell_price * q, 2));
      update products set stock_qty = stock_qty - q, updated_at = now() where id = p.id;
    end loop;
  end if;
  return s;
end $$;

-- Owner only. Puts item stock back.
create or replace function public.void_sale(p_sale uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_owner() then raise exception 'Only the owner can void a sale'; end if;
  update sales set voided_at = now(), voided_by = auth.uid(), void_reason = nullif(trim(p_reason), '')
   where id = p_sale and voided_at is null;
  if not found then raise exception 'Sale not found or already voided'; end if;
  update products p set stock_qty = p.stock_qty + si.qty, updated_at = now()
    from sale_items si where si.sale_id = p_sale and si.product_id = p.id;
end $$;

-- ============ row level security ============
alter table public.settings      enable row level security;
alter table public.staff         enable row level security;
alter table public.products      enable row level security;
alter table public.business_days enable row level security;
alter table public.sales         enable row level security;
alter table public.sale_items    enable row level security;

create policy "staff read"   on public.settings      for select to authenticated using (is_staff());
create policy "owner update" on public.settings      for update to authenticated using (is_owner());
create policy "staff read"   on public.staff         for select to authenticated using (is_staff());
create policy "owner update" on public.staff         for update to authenticated using (is_owner());
create policy "staff read"   on public.products      for select to authenticated using (is_staff());
create policy "owner insert" on public.products      for insert to authenticated with check (is_owner());
create policy "owner update" on public.products      for update to authenticated using (is_owner());
create policy "staff read"   on public.business_days for select to authenticated using (is_staff());
create policy "staff read"   on public.sales         for select to authenticated using (is_staff());
create policy "staff read"   on public.sale_items    for select to authenticated using (is_staff());
-- Opening, closing, selling and voiding go through the functions above.

-- ============ optional: run the schedule even when nobody opens the app ============
-- Database → Extensions → enable pg_cron, then run:
-- select cron.schedule('dokan-auto-tick', '*/5 * * * *', 'select public.auto_tick()');
