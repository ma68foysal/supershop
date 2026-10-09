-- 007: full access for every staff member (the owner's brother works as staff).
-- Staff can now do everything the owner can with sales, reports, products and settings:
-- change past days, see and set buying prices. Only the owner manages staff logins and roles.

-- Any staff member may change any sale, on any day
create or replace function public.can_change_sale(p_sale uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select is_staff() and exists (select 1 from sales where id = p_sale);
$$;

-- Sales may be added to a closed day by any staff member
create or replace function public.create_sale(payload jsonb)
returns public.sales
language plpgsql security definer set search_path = public as $$
declare
  d business_days; s sales; it jsonb; p products; q numeric; a numeric;
  v_kind sale_kind := (payload->>'kind')::sale_kind;
  v_sub numeric(12,2) := 0;
  v_disc numeric(12,2) := greatest(coalesce((payload->>'discount')::numeric, 0), 0);
begin
  if not is_staff() then raise exception 'Not allowed'; end if;
  if payload ? 'day_id' then
    select * into d from business_days where id = (payload->>'day_id')::uuid for update;
    if not found then raise exception 'Day not found'; end if;
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
      select * into p from products where id = (it->>'product_id')::uuid and active;
      if not found then raise exception 'A product in the cart no longer exists'; end if;
      if it ? 'amount' then
        a := (it->>'amount')::numeric;
        if a is null or a <= 0 then raise exception 'Enter an amount above zero'; end if;
        if p.sell_price <= 0 then raise exception 'This product has no price'; end if;
        v_sub := v_sub + round(a, 2);
      else
        q := (it->>'qty')::numeric;
        if q is null or q <= 0 then raise exception 'Quantity must be above zero'; end if;
        v_sub := v_sub + round(p.sell_price * q, 2);
      end if;
    end loop;
  end if;

  insert into sales (business_day_id, receipt_no, kind, subtotal, discount, total, note, created_by)
  values (d.id, d.next_receipt, v_kind, v_sub, least(v_disc, v_sub), v_sub - least(v_disc, v_sub),
          nullif(trim(payload->>'note'), ''), auth.uid())
  returning * into s;

  update business_days set next_receipt = next_receipt + 1 where id = d.id;

  if v_kind = 'items' then
    for it in select * from jsonb_array_elements(payload->'items') loop
      select * into p from products where id = (it->>'product_id')::uuid;
      if it ? 'amount' then
        a := round((it->>'amount')::numeric, 2);
        q := greatest(round(a / p.sell_price, 3), 0.001);
      else
        q := (it->>'qty')::numeric;
        a := round(p.sell_price * q, 2);
      end if;
      insert into sale_items (sale_id, product_id, name, unit, qty, unit_price, line_total, unit_cost)
      values (s.id, p.id, p.name, p.unit, q, p.sell_price, a, p.cost_price);
      update products set stock_qty = stock_qty - q, updated_at = now() where id = p.id;
    end loop;
  end if;
  return s;
end $$;

create or replace function public.delete_day(p_day uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'Not allowed'; end if;
  update products p set stock_qty = p.stock_qty + x.q, updated_at = now()
    from (select si.product_id, sum(si.qty) q
            from sale_items si join sales s on s.id = si.sale_id
           where s.business_day_id = p_day and s.voided_at is null and si.product_id is not null
           group by 1) x
   where p.id = x.product_id;
  delete from business_days where id = p_day;
  if not found then raise exception 'Day not found'; end if;
end $$;

create or replace function public.set_counted_cash(p_day uuid, p_cash numeric)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'Not allowed'; end if;
  update business_days set counted_cash = p_cash where id = p_day;
  if not found then raise exception 'Day not found'; end if;
end $$;

-- Buying prices: staff may now see and set them
drop trigger if exists products_keep_cost_price on public.products;
drop function if exists public.keep_cost_price();

-- Shop settings (name, address, hours): any staff member
drop policy if exists "owner update" on public.settings;
create policy "staff update" on public.settings for update to authenticated using (is_staff());
