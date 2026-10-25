-- Recycling: exit proceeds a fund puts back to work instead of distributing.
--
-- An LPA caps recycling (a share of commitments, or of the management fees paid), usually stops it
-- at a date (the end of the investment period), and may say what it can pay for. Within those
-- limits each distribution can be recycled in part, in whole or not at all, booked one of two ways
-- (packages/fund-engine/src/recycling.ts):
--
--   retained  never distributed. The cash stays in the fund and later calls are smaller. Nothing
--             is posted: the register row is the whole record, and it counts against the cap.
--   deemed    distributed and recontributed. ONE journal entry (source_type 'recycled_proceeds')
--             pays each partner a distribution and takes the same amount back as a contribution,
--             through the 2300 payable, with no cash and no notices. The distribution is
--             recallable, so the partner's uncalled commitment is unchanged by it
--             (recontributedByLp in the fund engine).
--
-- ADDITIVE AND SAFE BEFORE DEPLOY. New nullable or defaulted columns on vehicle_waterfall_terms
-- (the live release upserts its own columns by name and never touches these) and a new table that
-- nothing reads until this release ships. lib/accounting/recycling.ts is the one write path.

alter table public.vehicle_waterfall_terms
  -- The cap as a fraction of `recycle_cap_basis`. 0 = the fund does not recycle.
  add column if not exists recycle_cap_rate numeric not null default 0
    check (recycle_cap_rate >= 0 and recycle_cap_rate <= 2),
  add column if not exists recycle_cap_basis text not null default 'commitments'
    check (recycle_cap_basis in ('commitments', 'management_fees')),
  -- Proceeds received after this date are not recycled. Null = no end date.
  add column if not exists recycle_until date,
  add column if not exists recycle_uses text not null default 'any'
    check (recycle_uses in ('any', 'new_investments', 'follow_ons')),
  add column if not exists recycle_default_treatment text not null default 'retained'
    check (recycle_default_treatment in ('retained', 'deemed'));

create table public.recycled_proceeds (
  id               uuid primary key default gen_random_uuid(),
  fund_id          uuid not null references funds(id) on delete cascade,
  vehicle_id       uuid not null references fund_vehicles(id) on delete cascade,
  -- When the proceeds were received (and, for deemed, the date of the netted entry).
  recycled_on      date not null,
  amount           numeric not null check (amount > 0),
  treatment        text not null check (treatment in ('retained', 'deemed')),
  -- The exit the proceeds came from, when there is one in the portfolio.
  company_id       uuid references companies(id) on delete set null,
  description      text,
  -- The netted entry for a deemed row. Null for retained.
  journal_entry_id uuid references journal_entries(id) on delete set null,
  created_by       uuid,
  created_at       timestamptz not null default now(),
  check (treatment = 'deemed' or journal_entry_id is null)
);

create index recycled_proceeds_vehicle_idx on public.recycled_proceeds (fund_id, vehicle_id, recycled_on);

-- Data API access: service role only. Every read and write goes through the gated
-- lp_capital routes and agent tools, never the browser.
revoke all on public.recycled_proceeds from anon, authenticated;
grant select, insert, update, delete on public.recycled_proceeds to service_role;
alter table public.recycled_proceeds enable row level security;
