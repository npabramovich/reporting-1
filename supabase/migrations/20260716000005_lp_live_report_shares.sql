-- Which LPs can see the LIVE report in their portal.
--
-- The portal is moving off frozen snapshots: instead of "freeze a snapshot, then share that
-- snapshot", the GP now PUBLISHES the live report to chosen LPs, and each LP sees their own slice
-- of the current live data (derived, as-of-today) in their portal overview. This table is the
-- per-LP publish list — one row per (fund, investor) that has been granted the live report.
--
-- Deliberately mirrors lp_snapshot_shares (same shape, same policies) so the existing
-- "Share with LPs" investor-picker (LpSharePanel) works against it unchanged.

create table public.lp_live_report_shares (
  id             uuid primary key default gen_random_uuid(),
  fund_id        uuid not null references funds(id) on delete cascade,
  lp_investor_id uuid not null references lp_investors(id) on delete cascade,
  created_at     timestamptz not null default now(),
  unique (fund_id, lp_investor_id)
);

create index lp_live_report_shares_fund_idx on public.lp_live_report_shares (fund_id);

grant select on public.lp_live_report_shares to anon;
grant select, insert, update, delete on public.lp_live_report_shares to authenticated, service_role;

alter table public.lp_live_report_shares enable row level security;

create policy "Fund members read their fund's live report shares"
  on public.lp_live_report_shares for select to authenticated
  using (exists (
    select 1 from fund_members fm
    where fm.fund_id = lp_live_report_shares.fund_id and fm.user_id = auth.uid()
  ));

create policy "Fund admins manage their fund's live report shares"
  on public.lp_live_report_shares for all to authenticated
  using (exists (
    select 1 from fund_members fm
    where fm.fund_id = lp_live_report_shares.fund_id and fm.user_id = auth.uid() and fm.role = 'admin'
  ))
  with check (exists (
    select 1 from fund_members fm
    where fm.fund_id = lp_live_report_shares.fund_id and fm.user_id = auth.uid() and fm.role = 'admin'
  ));
