-- Fees the GP earns from portfolio companies (transaction, monitoring and directors' fees), which an
-- LPA often credits against the management fee (lib/accounting/portfolio-fees.ts). They're paid to
-- the GP or the management company, not the fund, so the fund's books have no line for them; this
-- is where they're recorded so the vehicle's fee schedule can offset them
-- (vehicle_accounting_settings.fee_schedule.offsets, the fund engine's feeSchedule).
--
-- ADDITIVE AND SAFE BEFORE DEPLOY. A new table the live release neither reads nor writes.

create table public.portfolio_company_fees (
  id          uuid primary key default gen_random_uuid(),
  fund_id     uuid not null references public.funds(id) on delete cascade,
  -- The vehicle whose management fee the offset reduces.
  vehicle_id  uuid not null references public.fund_vehicles(id) on delete cascade,
  -- The company that paid it, when known. A deleted company leaves the fee standing: the offset
  -- it earned was still earned.
  company_id  uuid references public.companies(id) on delete set null,
  fee_date    date not null,
  kind        text not null check (kind in ('transaction', 'monitoring', 'directors', 'other')),
  amount      numeric(18, 2) not null check (amount > 0),
  memo        text,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

-- Grants — required from 2026-05-30 onward for the Data API to see this table.
-- anon = SELECT only; authenticated + service_role full CRUD, with RLS scoping per-row access.
grant select on public.portfolio_company_fees to anon;
grant select, insert, update, delete on public.portfolio_company_fees to authenticated, service_role;

alter table public.portfolio_company_fees enable row level security;

-- Gated on `accounting`, like the fee schedule that reads them (lib/access/table-domains.ts).
create policy "portfolio_company_fees read needs accounting"
  on public.portfolio_company_fees for select to authenticated
  using (fund_id = any(public.fund_ids_readable('accounting')));
create policy "portfolio_company_fees insert needs accounting write"
  on public.portfolio_company_fees for insert to authenticated
  with check (fund_id = any(public.fund_ids_writable('accounting')));
create policy "portfolio_company_fees update needs accounting write"
  on public.portfolio_company_fees for update to authenticated
  using (fund_id = any(public.fund_ids_writable('accounting')))
  with check (fund_id = any(public.fund_ids_writable('accounting')));
create policy "portfolio_company_fees delete needs accounting write"
  on public.portfolio_company_fees for delete to authenticated
  using (fund_id = any(public.fund_ids_writable('accounting')));

-- Whose: only the caller's entities, the predicate 20261007100200_entity_rls.sql gives a table with
-- vehicle_id and company_id. A write also may not name a company the caller can't see.
create policy "Only the caller's entities"
  on public.portfolio_company_fees as restrictive for all to authenticated
  using (vehicle_id = any((select public.vehicle_ids_readable())::uuid[]))
  with check (
    vehicle_id = any((select public.vehicle_ids_readable())::uuid[])
    and (fund_id = any((select public.unscoped_fund_ids())::uuid[])
         or company_id is null or company_id = any((select public.company_ids_readable())::uuid[]))
  );

create index portfolio_company_fees_vehicle_idx
  on public.portfolio_company_fees (fund_id, vehicle_id, fee_date);
