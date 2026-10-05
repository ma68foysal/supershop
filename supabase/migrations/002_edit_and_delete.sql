-- 002: edit and delete for sales, days and products (owner only).
-- Run after supabase/schema.sql (new setups run schema.sql, then every file in this folder in order).

-- Put a sale's item stock back (internal)
create or replace function public._restore_stock(p_sale uuid)
returns void
language sql security definer set search_path = public as $$
  update products p set stock_qty = p.stock_qty + si.qty, updated_at = now()
    from sale_items si where si.sale_id = p_sale and si.product_id = p.id;
$$;
revoke execute on function public._restore_stock(uuid) from public, anon, authenticated;

-- Sales can be added to a past (closed) day by the owner: payload.day_id
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
  if payload ? 'day_id' then
    select * into d from business_days where id = (payload->>'day_id')::uuid for update;
    if not found then raise exception 'Day not found'; end if;
    if d.status = 'closed' and not is_owner() then raise exception 'Only the owner can change reports'; end if;
  else
    select * into d from business_days where status = 'open' for update;
    if not found then raise exception 'The shop is closed. Open the shop to start selling'; end if;
  end if;

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

-- Owner only. Reason is optional. Puts item stock back.
create or replace function public.void_sale(p_sale uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_owner() then raise exception 'Only the owner can void a sale'; end if;
  update sales set voided_at = now(), voided_by = auth.uid(), void_reason = nullif(trim(p_reason), '')
   where id = p_sale and voided_at is null;
  if not found then raise exception 'Sale not found or already voided'; end if;
  perform _restore_stock(p_sale);
end $$;

-- Owner only. Removes the sale for good; stock goes back unless it was already voided.
create or replace function public.delete_sale(p_sale uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare s sales;
begin
  if not is_owner() then raise exception 'Only the owner can change sales'; end if;
  select * into s from sales where id = p_sale for update;
  if not found then raise exception 'Sale not found'; end if;
  if s.voided_at is null then perform _restore_stock(p_sale); end if;
  delete from sales where id = p_sale;
end $$;

-- Owner only.
-- quick: {total, note}
-- items: {items: [{id, qty}], discount, note}; lines left out are removed. Prices stay as sold.
create or replace function public.update_sale(p_sale uuid, payload jsonb)
returns public.sales
language plpgsql security definer set search_path = public as $$
declare s sales; it jsonb; q numeric; v_sub numeric(12,2); v_disc numeric(12,2);
begin
  if not is_owner() then raise exception 'Only the owner can change sales'; end if;
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

-- Owner only. Deletes a whole day with all its sales; stock from its sales goes back.
create or replace function public.delete_day(p_day uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_owner() then raise exception 'Only the owner can change reports'; end if;
  update products p set stock_qty = p.stock_qty + x.q, updated_at = now()
    from (select si.product_id, sum(si.qty) q
            from sale_items si join sales s on s.id = si.sale_id
           where s.business_day_id = p_day and s.voided_at is null and si.product_id is not null
           group by 1) x
   where p.id = x.product_id;
  delete from business_days where id = p_day;
  if not found then raise exception 'Day not found'; end if;
end $$;

-- Owner only. Change (or clear) the cash counted at closing.
create or replace function public.set_counted_cash(p_day uuid, p_cash numeric)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_owner() then raise exception 'Only the owner can change reports'; end if;
  update business_days set counted_cash = p_cash where id = p_day;
  if not found then raise exception 'Day not found'; end if;
end $$;

-- Products can be deleted by the owner; past sales keep the product name
create policy "owner delete" on public.products for delete to authenticated using (is_owner());
