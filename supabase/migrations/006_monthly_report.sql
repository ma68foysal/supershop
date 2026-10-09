-- 006: monthly report and profit.
-- Each sale line now remembers the buying price at the moment of sale (unit_cost), so profit
-- doesn't shift when a buying price changes later. Older lines fall back to the current price.

alter table public.sale_items add column if not exists unit_cost numeric(12,2);

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

-- Totals for a date range (a month), worked out in the database so it stays fast.
-- Runs with the caller's permissions; every signed-in staff member can read reports.
create or replace function public.period_report(p_from date, p_to date)
returns jsonb
language sql stable set search_path = public as $$
  with d as (
    select * from business_days where day_date between p_from and p_to
  ),
  s as (
    select s.* from sales s join d on d.id = s.business_day_id where s.voided_at is null
  ),
  i as (
    select si.name, si.unit, si.qty, si.line_total, coalesce(si.unit_cost, p.cost_price) as cost
      from sale_items si
      join s on s.id = si.sale_id
      left join products p on p.id = si.product_id
  ),
  per_day as (
    select d.day_date, coalesce(sum(x.total), 0) as total, coalesce(sum(x.n), 0) as sales
      from d
      left join (select business_day_id, sum(total) as total, count(*) as n from s group by 1) x
        on x.business_day_id = d.id
     group by d.day_date
  )
  select jsonb_build_object(
    'days', coalesce((select jsonb_agg(jsonb_build_object('date', day_date, 'total', total, 'sales', sales)
                                       order by day_date) from per_day), '[]'::jsonb),
    'total', coalesce((select sum(total) from s), 0),
    'sales', (select count(*) from s),
    'quick_total', coalesce((select sum(total) from s where kind = 'quick'), 0),
    'items_total', coalesce((select sum(total) from s where kind = 'items'), 0),
    'discount', coalesce((select sum(discount) from s), 0),
    'voids', (select count(*) from sales v join d on d.id = v.business_day_id where v.voided_at is not null),
    'top_items', coalesce((select jsonb_agg(t order by t.amount desc) from (
                   select name, unit, sum(qty) as qty, sum(line_total) as amount
                     from i group by name, unit order by sum(line_total) desc limit 15) t), '[]'::jsonb),
    'item_revenue', coalesce((select sum(line_total) from i), 0),
    'costed_revenue', coalesce((select sum(line_total) from i where cost is not null), 0),
    'cost', coalesce((select sum(round(qty * cost, 2)) from i where cost is not null), 0)
  );
$$;
