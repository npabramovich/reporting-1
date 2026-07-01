-- LP portal access log. Records when an LP (or one of their authorized users)
-- logs in, views, or downloads content in the portal. Powers the GP-side
-- "LP Activity" analytics page and, later, LP-facing "last viewed / access
-- history" and unread-document indicators.
--
-- Written exclusively from the /portal API routes via the service-role client
-- (LPs never insert directly). Titles are denormalized (target_title) so the
-- log stays readable even after the underlying snapshot/letter/document is
-- renamed or deleted.
create table public.lp_access_events (
  id             uuid primary key default gen_random_uuid(),
  fund_id        uuid not null references funds(id) on delete cascade,
  -- Who acted. Nullable so history survives if the LP account is later removed.
  lp_account_id  uuid references lp_accounts(id) on delete set null,
  auth_user_id   uuid references auth.users(id) on delete set null,
  -- Primary investor context of the access (the LP whose data was accessed).
  -- Nullable for login/portal events; metadata.investor_ids holds the full set
  -- when an access spans more than one investor (authorized-user case).
  lp_investor_id uuid references lp_investors(id) on delete set null,
  event_type     text not null check (event_type in ('login', 'view', 'download')),
  target_type    text not null check (target_type in ('portal', 'snapshot', 'letter', 'document')),
  target_id      uuid,
  target_title   text,
  metadata       jsonb not null default '{}',
  created_at     timestamptz not null default now()
);

-- Grants — anon SELECT only; authenticated + service_role full CRUD, RLS scopes
-- rows. (Matches the repo's default posture; see CLAUDE.md.)
grant select on public.lp_access_events to anon;
grant select, insert, update, delete on public.lp_access_events to authenticated, service_role;

alter table public.lp_access_events enable row level security;

-- Fund members read their fund's access events (defense-in-depth; the GP API
-- reads via the service-role client). Inserts come from the service-role portal
-- API, so no authenticated insert policy is needed.
create policy "Fund members read their fund's LP access events"
  on public.lp_access_events for select to authenticated
  using (exists (
    select 1 from fund_members fm
    where fm.fund_id = lp_access_events.fund_id and fm.user_id = auth.uid()
  ));

-- Recent-activity feed per fund.
create index lp_access_events_fund_created_idx
  on public.lp_access_events (fund_id, created_at desc);
-- "Activity for a given LP account" and last-seen lookups.
create index lp_access_events_account_created_idx
  on public.lp_access_events (fund_id, lp_account_id, created_at desc);
-- "Who accessed this document/snapshot/letter" and unread computation.
create index lp_access_events_target_idx
  on public.lp_access_events (fund_id, target_type, target_id);
