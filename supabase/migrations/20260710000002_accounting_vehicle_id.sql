-- Phase 2 (accounting): promote the vehicle to a foreign key. Each accounting
-- table is currently scoped by the free-text `portfolio_group` string; add a
-- `vehicle_id` → the fund_vehicles registry and backfill it by matching the
-- (Phase-1-canonicalized) portfolio_group to the vehicle name. portfolio_group
-- stays for now and is dropped once every subsystem is on vehicle_id.

alter table public.chart_of_accounts add column if not exists vehicle_id uuid references fund_vehicles(id) on delete cascade;
alter table public.fiscal_periods     add column if not exists vehicle_id uuid references fund_vehicles(id) on delete cascade;
alter table public.journal_entries    add column if not exists vehicle_id uuid references fund_vehicles(id) on delete cascade;
alter table public.journal_postings   add column if not exists vehicle_id uuid references fund_vehicles(id) on delete cascade;
alter table public.bank_transactions  add column if not exists vehicle_id uuid references fund_vehicles(id) on delete cascade;
alter table public.allocation_runs    add column if not exists vehicle_id uuid references fund_vehicles(id) on delete cascade;
alter table public.allocation_results add column if not exists vehicle_id uuid references fund_vehicles(id) on delete cascade;

-- Backfill from the registry (portfolio_group is canonical after the Phase-1 re-tag).
update public.chart_of_accounts t set vehicle_id = v.id from public.fund_vehicles v where v.fund_id = t.fund_id and v.name = t.portfolio_group and t.vehicle_id is null;
update public.fiscal_periods     t set vehicle_id = v.id from public.fund_vehicles v where v.fund_id = t.fund_id and v.name = t.portfolio_group and t.vehicle_id is null;
update public.journal_entries    t set vehicle_id = v.id from public.fund_vehicles v where v.fund_id = t.fund_id and v.name = t.portfolio_group and t.vehicle_id is null;
update public.journal_postings   t set vehicle_id = v.id from public.fund_vehicles v where v.fund_id = t.fund_id and v.name = t.portfolio_group and t.vehicle_id is null;
update public.bank_transactions  t set vehicle_id = v.id from public.fund_vehicles v where v.fund_id = t.fund_id and v.name = t.portfolio_group and t.vehicle_id is null;
update public.allocation_runs    t set vehicle_id = v.id from public.fund_vehicles v where v.fund_id = t.fund_id and v.name = t.portfolio_group and t.vehicle_id is null;
update public.allocation_results t set vehicle_id = v.id from public.fund_vehicles v where v.fund_id = t.fund_id and v.name = t.portfolio_group and t.vehicle_id is null;

create index if not exists chart_of_accounts_vehicle_idx on public.chart_of_accounts (fund_id, vehicle_id, code);
create index if not exists fiscal_periods_vehicle_idx     on public.fiscal_periods (fund_id, vehicle_id, period_end desc);
create index if not exists journal_entries_vehicle_idx    on public.journal_entries (fund_id, vehicle_id, entry_date desc);
create index if not exists journal_postings_vehicle_idx   on public.journal_postings (fund_id, vehicle_id);
create index if not exists bank_transactions_vehicle_idx  on public.bank_transactions (fund_id, vehicle_id, txn_date desc);
create index if not exists allocation_runs_vehicle_idx    on public.allocation_runs (fund_id, vehicle_id, created_at desc);
create index if not exists allocation_results_vehicle_idx on public.allocation_results (fund_id, vehicle_id, lp_entity_id);
