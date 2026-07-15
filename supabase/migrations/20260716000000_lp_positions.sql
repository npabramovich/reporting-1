-- Dated cumulative LP positions — the store for capital tracking without a ledger.
--
-- One row = one LP's stated position on one date, exactly as it arrives from a statement
-- (commitment, called/paid-in, distributions, NAV). This is the SOURCE OF TRUTH for a
-- tracking vehicle: what we store is what we were given. Movements (the roll-forward lines
-- on a capital-account statement) are DERIVED by subtracting consecutive dated positions at
-- read time — never stored, so there is no second copy to drift.
--
-- WHY POSITIONS, NOT MOVEMENTS. Pasted statement data is always a cumulative position as-of
-- a date. Storing movements would force a decomposition at paste time and risk the stored
-- movements disagreeing with the statement they came from. Storing the position verbatim
-- removes that risk. See docs/plan-lp-tracking-architecture.md.
--
-- This is `lp_investments` freed from the snapshot container: the same figures, keyed by an
-- as_of_date instead of belonging to a named snapshot. Snapshots become a frozen archive;
-- these dated positions are the live data.

create table public.lp_positions (
  id             uuid primary key default gen_random_uuid(),
  fund_id        uuid not null references funds(id) on delete cascade,
  vehicle_id     uuid not null references fund_vehicles(id) on delete cascade,
  lp_entity_id   uuid not null references lp_entities(id) on delete cascade,
  as_of_date     date not null,

  -- The figures, as stated. NAV is the reliable primitive (0 is a valid, fully-realized
  -- position); total_value is derived (= distributions + NAV), so it is NOT stored here.
  commitment      numeric,
  called_capital  numeric,   -- = paid-in capital; the two names are one figure
  distributions   numeric,
  nav             numeric,

  imported_at    timestamptz not null default now(),
  imported_by    uuid references auth.users(id),
  source         text not null default 'manual' check (source in ('paste', 'manual', 'migrated')),

  -- One position per LP per date. Re-pasting a date upserts.
  unique (fund_id, vehicle_id, lp_entity_id, as_of_date)
);

-- The dominant read is "the latest position on-or-before a date, per entity, for a vehicle".
create index lp_positions_vehicle_date_idx
  on public.lp_positions (fund_id, vehicle_id, as_of_date desc);
create index lp_positions_entity_idx
  on public.lp_positions (fund_id, lp_entity_id);

grant select on public.lp_positions to anon;
grant select, insert, update, delete on public.lp_positions to authenticated, service_role;

alter table public.lp_positions enable row level security;

create policy "Fund members read their fund's LP positions"
  on public.lp_positions for select to authenticated
  using (exists (
    select 1 from fund_members fm
    where fm.fund_id = lp_positions.fund_id and fm.user_id = auth.uid()
  ));

create policy "Fund admins manage their fund's LP positions"
  on public.lp_positions for all to authenticated
  using (exists (
    select 1 from fund_members fm
    where fm.fund_id = lp_positions.fund_id and fm.user_id = auth.uid() and fm.role = 'admin'
  ))
  with check (exists (
    select 1 from fund_members fm
    where fm.fund_id = lp_positions.fund_id and fm.user_id = auth.uid() and fm.role = 'admin'
  ));

-- NOTE: this migration originally carried a one-time backfill that copied every existing
-- snapshot's lp_investments into lp_positions. That has already been applied where it was needed,
-- and it is DELIBERATELY REMOVED here: a fresh install has no snapshots to copy, so the block was
-- pure downside — it could abort the whole migration on a fund with two same-date snapshots
-- (duplicate ON CONFLICT target in one statement). The live tracking model is populated by the
-- paste/import flow, not by this migration.

comment on table public.lp_positions is
  'Dated cumulative LP positions per vehicle — the source of truth for capital tracking without a ledger. Movements are derived by diffing consecutive dates at read time.';
