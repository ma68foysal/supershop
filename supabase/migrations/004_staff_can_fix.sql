-- 004: staff can fix their own mistakes.
-- Staff: edit / void / delete sales of the day that is open now; add, edit, delete products and SRs.
-- Owner only: past (closed) days, settings, staff logins, and products' buying price.

-- ---------- sales: staff may change sales of the open day ----------
create or replace function public.can_change_sale(p_sale uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select is_owner() or (
    is_staff() and exists (
      select 1 from sales s join business_days d on d.id = s.business_day_id
       where s.id = p_sale and d.status = 'open'
    )
  );
$$;

create or replace function public.void_sale(p_sale uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not can_change_sale(p_sale) then raise exception 'Staff can only change today''s sales'; end if;
  update sales set voided_at = now(), voided_by = auth.uid(), void_reason = nullif(trim(p_reason), '')
   where id = p_sale and voided_at is null;
  if not found then raise exception 'Sale not found or already voided'; end if;
  perform _restore_stock(p_sale);
end $$;

create or replace function public.delete_sale(p_sale uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare s sales;
begin
  if not can_change_sale(p_sale) then raise exception 'Staff can only change today''s sales'; end if;
  select * into s from sales where id = p_sale for update;
  if not found then raise exception 'Sale not found'; end if;
  if s.voided_at is null then perform _restore_stock(p_sale); end if;
  delete from sales where id = p_sale;
end $$;

create or replace function public.update_sale(p_sale uuid, payload jsonb)
returns public.sales
language plpgsql security definer set search_path = public as $$
declare s sales; it jsonb; q numeric; v_sub numeric(12,2); v_disc numeric(12,2);
begin
  if not can_change_sale(p_sale) then raise exception 'Staff can only change today''s sales'; end if;
  select * into s from sales where id = p_sale for update;
  if not found then raise exception 'Sale not found'; end if;
  if s.voided_at is not null then raise exception 'A voided sale can''t be edited'; end if;

  if s.kind = 'quick' then
    v_sub := (payload->>'total')::numeric;
    if v_sub is null or v_sub <= 0 then raise exception 'Enter an amount above zero'; end if;
    update sales set subtotal = v_sub, discount = 0, total = v_sub, note = nullif(trim(payload->>'note'), '')
     where id = p_sale returning * into s;
    return s;
  end if;

  if jsonb_array_length(coalesce(payload->'items', '[]'::jsonb)) = 0 then
    raise exception 'Add at least one item';
  end if;
  for it in select * from jsonb_array_elements(payload->'items') loop
    q := (it->>'qty')::numeric;
    if q is null or q <= 0 then raise exception 'Quantity must be above zero'; end if;
  end loop;

  perform _restore_stock(p_sale);
  delete from sale_items
   where sale_id = p_sale
     and id not in (select (x->>'id')::uuid from jsonb_array_elements(payload->'items') x);
  for it in select * from jsonb_array_elements(payload->'items') loop
    q := (it->>'qty')::numeric;
    update sale_items set qty = q, line_total = round(unit_price * q, 2)
     where id = (it->>'id')::uuid and sale_id = p_sale;
  end loop;
  update products p set stock_qty = p.stock_qty - si.qty, updated_at = now()
    from sale_items si where si.sale_id = p_sale and si.product_id = p.id;

  select coalesce(sum(line_total), 0) into v_sub from sale_items where sale_id = p_sale;
  v_disc := least(greatest(coalesce((payload->>'discount')::numeric, 0), 0), v_sub);
  update sales set subtotal = v_sub, discount = v_disc, total = v_sub - v_disc,
                   note = nullif(trim(payload->>'note'), '')
   where id = p_sale returning * into s;
  return s;
end $$;

-- ---------- products: any staff may add, edit, delete ----------
drop policy if exists "owner insert" on public.products;
drop policy if exists "owner update" on public.products;
drop policy if exists "owner delete" on public.products;
create policy "staff insert" on public.products for insert to authenticated with check (is_staff());
create policy "staff update" on public.products for update to authenticated using (is_staff());
create policy "staff delete" on public.products for delete to authenticated using (is_staff());

-- Buying price is the owner's: staff can't set or change it
create or replace function public.keep_cost_price()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not is_owner() then
    new.cost_price := case when tg_op = 'UPDATE' then old.cost_price else null end;
  end if;
  return new;
end $$;
create trigger products_keep_cost_price
  before insert or update on public.products
  for each row execute function public.keep_cost_price();

-- ---------- SRs: any staff may add, edit, delete ----------
drop policy if exists "owner insert" on public.srs;
drop policy if exists "owner update" on public.srs;
drop policy if exists "owner delete" on public.srs;
create policy "staff insert" on public.srs for insert to authenticated with check (is_staff());
create policy "staff update" on public.srs for update to authenticated using (is_staff());
create policy "staff delete" on public.srs for delete to authenticated using (is_staff());
