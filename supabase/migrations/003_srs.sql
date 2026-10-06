-- 003: company SRs (sales representatives who take the shop's orders)

create table public.srs (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  company     text,
  phone       text not null,
  -- days they usually come: 0 = Sunday … 6 = Saturday
  visit_days  smallint[] not null default '{}',
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Which SR brings each product (for "running low, call the SR")
alter table public.products add column sr_id uuid references public.srs(id) on delete set null;

alter table public.srs enable row level security;
create policy "staff read"   on public.srs for select to authenticated using (is_staff());
create policy "owner insert" on public.srs for insert to authenticated with check (is_owner());
create policy "owner update" on public.srs for update to authenticated using (is_owner());
create policy "owner delete" on public.srs for delete to authenticated using (is_owner());
