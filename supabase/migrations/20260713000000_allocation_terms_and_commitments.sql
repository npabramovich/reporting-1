-- Allocation configuration for the period close.
--
-- Three gaps this fills:
--   1. The allocation basis was hardcoded to commitment. Some LPAs allocate on
--      capital-account balance instead. Now a per-vehicle setting.
--   2. A partner's commitment was a single scalar in lp_investments with no history,
--      so it could not change over time and a commitment TRANSFER between partners
--      was unrepresentable. Now an effective-dated event log.
--   3. Fee/expense participation was all-or-nothing and implicit. A GP entity that
--      shouldn't bear management fee, or an LP with a side-letter rate, had nowhere
--      to live. Now explicit per-partner, per-category terms.

-- ---------------------------------------------------------------------------
-- 1. Per-vehicle accounting settings
-- ---------------------------------------------------------------------------
create table public.vehicle_accounting_settings (
  id               uuid primary key default gen_random_uuid(),
  fund_id          uuid not null references funds(id) on delete cascade,
  vehicle_id       uuid not null references fund_vehicles(id) on delete cascade,
  -- What the period close splits P&L on.
  --   commitment      — pro-rata by committed capital (the common default)
  --   capital_balance — pro-rata by each partner's capital account at period end
  allocation_basis text not null default 'commitment'
                   check (allocation_basis in ('commitment', 'capital_balance')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (fund_id, vehicle_id)
);

grant select on public.vehicle_accounting_settings to anon;
grant select, insert, update, delete on public.vehicle_accounting_settings to authenticated, service_role;

alter table public.vehicle_accounting_settings enable row level security;

create policy "Fund members read their fund's accounting settings"
  on public.vehicle_accounting_settings for select to authenticated
  using (exists (
    select 1 from fund_members fm
    where fm.fund_id = vehicle_accounting_settings.fund_id and fm.user_id = auth.uid()
  ));

create policy "Fund admins manage their fund's accounting settings"
  on public.vehicle_accounting_settings for all to authenticated
  using (exists (
    select 1 from fund_members fm
    where fm.fund_id = vehicle_accounting_settings.fund_id and fm.user_id = auth.uid() and fm.role = 'admin'
  ))
  with check (exists (
    select 1 from fund_members fm
    where fm.fund_id = vehicle_accounting_settings.fund_id and fm.user_id = auth.uid() and fm.role = 'admin'
  ));

-- ---------------------------------------------------------------------------
-- 2. Commitment events — effective-dated, signed deltas
-- ---------------------------------------------------------------------------
-- A partner's commitment as of any date is the SUM of their deltas up to it. Deltas
-- (not snapshots) because a transfer is naturally two rows that must net to zero:
-- −X for the transferor, +X for the transferee, same date, same transfer_id. A
-- snapshot model can't express "these two changes are one event" and lets a transfer
-- silently create or destroy commitment.
create table public.commitment_events (
  id             uuid primary key default gen_random_uuid(),
  fund_id        uuid not null references funds(id) on delete cascade,
  vehicle_id     uuid not null references fund_vehicles(id) on delete cascade,
  lp_entity_id   uuid not null references lp_entities(id) on delete cascade,
  effective_date date not null,
  -- Signed change to this partner's commitment. Negative reduces it.
  amount         numeric not null,
  kind           text not null default 'adjustment'
                 check (kind in ('initial', 'increase', 'decrease', 'transfer_in', 'transfer_out')),
  -- The other side of a transfer, and the id shared by both legs.
  counterparty_entity_id uuid references lp_entities(id) on delete set null,
  transfer_id    uuid,
  memo           text,
  created_at     timestamptz not null default now(),
  created_by     uuid references auth.users(id) on delete set null
);

create index commitment_events_lookup_idx
  on public.commitment_events (fund_id, vehicle_id, effective_date);
create index commitment_events_entity_idx
  on public.commitment_events (lp_entity_id);
create index commitment_events_transfer_idx
  on public.commitment_events (transfer_id) where transfer_id is not null;

grant select on public.commitment_events to anon;
grant select, insert, update, delete on public.commitment_events to authenticated, service_role;

alter table public.commitment_events enable row level security;

create policy "Fund members read their fund's commitment events"
  on public.commitment_events for select to authenticated
  using (exists (
    select 1 from fund_members fm
    where fm.fund_id = commitment_events.fund_id and fm.user_id = auth.uid()
  ));

create policy "Fund admins manage their fund's commitment events"
  on public.commitment_events for all to authenticated
  using (exists (
    select 1 from fund_members fm
    where fm.fund_id = commitment_events.fund_id and fm.user_id = auth.uid() and fm.role = 'admin'
  ))
  with check (exists (
    select 1 from fund_members fm
    where fm.fund_id = commitment_events.fund_id and fm.user_id = auth.uid() and fm.role = 'admin'
  ));

-- Backfill: every existing commitment becomes an 'initial' event. Dated 1970-01-01
-- deliberately — the real subscription date isn't recorded anywhere, and dating these
-- "today" would make every historical period see a zero commitment and allocate
-- nothing. An early date is the only choice that can't silently corrupt a back-period
-- close. Correct the dates from the subscription docs when convenient.
insert into public.commitment_events (fund_id, vehicle_id, lp_entity_id, effective_date, amount, kind, memo)
select
  li.fund_id,
  fv.id,
  li.entity_id,
  date '1970-01-01',
  li.commitment,
  'initial',
  'Backfilled from lp_investments — verify the subscription date'
from public.lp_investments li
join public.fund_vehicles fv
  on fv.fund_id = li.fund_id and fv.name = li.portfolio_group
where li.commitment is not null and li.commitment <> 0;

-- ---------------------------------------------------------------------------
-- 3. Per-partner, per-category allocation terms
-- ---------------------------------------------------------------------------
-- One row per (partner, category). Absent row = the default: participates, weighted
-- by the vehicle's allocation basis, no rate override. This generalizes "the GP entity
-- doesn't pay management fee" into "any partner can be excluded from, or reweighted
-- within, any category" — which is what side letters actually do.
create table public.partner_allocation_terms (
  id             uuid primary key default gen_random_uuid(),
  fund_id        uuid not null references funds(id) on delete cascade,
  vehicle_id     uuid not null references fund_vehicles(id) on delete cascade,
  lp_entity_id   uuid not null references lp_entities(id) on delete cascade,
  -- Matches the journal source_type the close allocates under.
  category       text not null
                 check (category in (
                   'management_fee', 'partnership_expense', 'organizational_expense',
                   'realized_gain', 'valuation', 'income', 'carried_interest'
                 )),
  -- false = bears none of this category; their share redistributes across the rest.
  participates   boolean not null default true,
  -- Fixed weight instead of the vehicle's basis (e.g. a negotiated share).
  weight_override numeric,
  -- Annual management-fee rate for this partner, when it differs from the fund's.
  rate_override  numeric,
  memo           text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (fund_id, vehicle_id, lp_entity_id, category)
);

create index partner_allocation_terms_lookup_idx
  on public.partner_allocation_terms (fund_id, vehicle_id, category);

grant select on public.partner_allocation_terms to anon;
grant select, insert, update, delete on public.partner_allocation_terms to authenticated, service_role;

alter table public.partner_allocation_terms enable row level security;

create policy "Fund members read their fund's allocation terms"
  on public.partner_allocation_terms for select to authenticated
  using (exists (
    select 1 from fund_members fm
    where fm.fund_id = partner_allocation_terms.fund_id and fm.user_id = auth.uid()
  ));

create policy "Fund admins manage their fund's allocation terms"
  on public.partner_allocation_terms for all to authenticated
  using (exists (
    select 1 from fund_members fm
    where fm.fund_id = partner_allocation_terms.fund_id and fm.user_id = auth.uid() and fm.role = 'admin'
  ))
  with check (exists (
    select 1 from fund_members fm
    where fm.fund_id = partner_allocation_terms.fund_id and fm.user_id = auth.uid() and fm.role = 'admin'
  ));

-- Sensible default: a GP-class partner bears no management fee and no carry on its own
-- capital. This is the near-universal treatment, and NOT applying it silently
-- overcharges the sponsor. Partners can still be edited individually afterwards.
insert into public.partner_allocation_terms (fund_id, vehicle_id, lp_entity_id, category, participates, memo)
select le.fund_id, fv.id, le.id, c.category, false, 'Default: GP-class partner bears no fee or carry'
from public.lp_entities le
join public.lp_investments li on li.entity_id = le.id and li.fund_id = le.fund_id
join public.fund_vehicles fv on fv.fund_id = li.fund_id and fv.name = li.portfolio_group
cross join (values ('management_fee'), ('carried_interest')) as c(category)
where le.partner_class = 'gp'
on conflict (fund_id, vehicle_id, lp_entity_id, category) do nothing;
