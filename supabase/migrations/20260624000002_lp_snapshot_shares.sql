-- Snapshot sharing (Phase 2 of LP reporting).
--
-- Snapshots stay immutable historical records; sharing is a separate, explicit,
-- auditable act. A row here means "this investor's slice of this snapshot is
-- visible in the LP portal." The LP read path resolves shared snapshots via
-- get_my_lp_investor_ids() and is served only through admin-client portal APIs
-- (LPs have no direct Data API access to the GP lp_* tables).

create table public.lp_snapshot_shares (
  id             uuid        primary key default gen_random_uuid(),
  snapshot_id    uuid        not null references lp_snapshots(id) on delete cascade,
  lp_investor_id uuid        not null references lp_investors(id) on delete cascade,
  fund_id        uuid        not null references funds(id) on delete cascade,
  shared_at      timestamptz not null default now(),
  shared_by      uuid        references auth.users(id) on delete set null,
  unique (snapshot_id, lp_investor_id)
);
create index lp_snapshot_shares_snapshot_idx on public.lp_snapshot_shares (snapshot_id);
create index lp_snapshot_shares_investor_idx on public.lp_snapshot_shares (lp_investor_id);
create index lp_snapshot_shares_fund_idx on public.lp_snapshot_shares (fund_id);

grant select on public.lp_snapshot_shares to authenticated;
grant select, insert, update, delete on public.lp_snapshot_shares to service_role;

alter table public.lp_snapshot_shares enable row level security;

-- GP admins manage shares for their fund.
create policy lp_snapshot_shares_admin on public.lp_snapshot_shares
  for all to authenticated
  using (fund_id in (select fund_id from fund_members where user_id = auth.uid() and role = 'admin'))
  with check (fund_id in (select fund_id from fund_members where user_id = auth.uid() and role = 'admin'));

-- An LP can read shares pointing at one of their own investors (defense-in-depth;
-- the portal serves data via the admin client, but this keeps the Data API honest).
create policy lp_snapshot_shares_lp_read on public.lp_snapshot_shares
  for select to authenticated
  using (lp_investor_id = any(public.get_my_lp_investor_ids()));
