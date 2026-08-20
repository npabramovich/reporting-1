-- Canonical registry of a fund's investment vehicles. Until now a "vehicle" was
-- a free-text `portfolio_group` string repeated across lp_investments,
-- fund_cash_flows, the accounting ledger, compliance, etc. — which fragmented on
-- typos/renames and let non-vehicles (companies, GP entities) leak into the
-- picker. This table is the single source of truth; `name` is the canonical
-- portfolio_group string, `aliases` are legacy spellings that map to it during
-- the transition, and `kind` distinguishes funds / SPVs / direct deals /
-- GP-associate entities.
create table public.fund_vehicles (
  id         uuid primary key default gen_random_uuid(),
  fund_id    uuid not null references funds(id) on delete cascade,
  name       text not null,
  kind       text not null default 'fund' check (kind in ('fund', 'spv', 'direct', 'associate', 'other')),
  aliases    text[] not null default '{}',
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (fund_id, name)
);

-- Grants — anon SELECT only; authenticated + service_role full CRUD, RLS scopes.
grant select on public.fund_vehicles to anon;
grant select, insert, update, delete on public.fund_vehicles to authenticated, service_role;

alter table public.fund_vehicles enable row level security;

create policy "Fund members read their fund's vehicles"
  on public.fund_vehicles for select to authenticated
  using (exists (
    select 1 from fund_members fm
    where fm.fund_id = fund_vehicles.fund_id and fm.user_id = auth.uid()
  ));

create policy "Fund admins manage their fund's vehicles"
  on public.fund_vehicles for all to authenticated
  using (exists (
    select 1 from fund_members fm
    where fm.fund_id = fund_vehicles.fund_id and fm.user_id = auth.uid() and fm.role = 'admin'
  ))
  with check (exists (
    select 1 from fund_members fm
    where fm.fund_id = fund_vehicles.fund_id and fm.user_id = auth.uid() and fm.role = 'admin'
  ));

create index fund_vehicles_fund_idx on public.fund_vehicles (fund_id, name);
