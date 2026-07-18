-- Pending actions — the general staging layer for Analyst-drafted writes.
--
-- The Analyst never mutates the books directly. When the model calls a WRITE tool, the tool runs
-- a read-only PREVIEW and stages a row here with status 'pending'; a human approves it (inline or
-- from the queue), and only then does the approval endpoint run the real EXECUTE — the exact same
-- write path the direct REST API uses. This generalizes the accounting "draft, then a human
-- applies" property to every included write action, through one table.
--
-- Drafting requires domain READ (to see/stage the tool); approving requires domain WRITE. The row
-- carries its `domain` so the approval endpoint can re-check write access against the caller.

create table public.pending_actions (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references funds(id) on delete cascade,
  vehicle_id uuid null references fund_vehicles(id),
  domain text not null,
  action_type text not null,
  args jsonb not null,
  preview jsonb not null,
  status text not null default 'pending',
  created_by uuid not null,
  created_via text null,
  approved_by uuid null,
  approved_at timestamptz null,
  applied_result jsonb null,
  error text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pending_actions_status_chk
    check (status in ('pending','approved','applied','rejected','failed'))
);

create index pending_actions_fund_status_idx on public.pending_actions (fund_id, status);

-- Grants — required from 2026-05-30 onward for the Data API to see this table.
-- anon = SELECT only; authenticated + service_role get full CRUD, with RLS scoping per-row access.
grant select on public.pending_actions to anon;
grant select, insert, update, delete on public.pending_actions to authenticated, service_role;

alter table public.pending_actions enable row level security;

create policy "Fund members read their fund's pending actions"
  on public.pending_actions for select to authenticated
  using (exists (
    select 1 from fund_members fm
    where fm.fund_id = pending_actions.fund_id and fm.user_id = auth.uid()
  ));

create policy "Fund admins manage their fund's pending actions"
  on public.pending_actions for all to authenticated
  using (exists (
    select 1 from fund_members fm
    where fm.fund_id = pending_actions.fund_id and fm.user_id = auth.uid() and fm.role = 'admin'
  ))
  with check (exists (
    select 1 from fund_members fm
    where fm.fund_id = pending_actions.fund_id and fm.user_id = auth.uid() and fm.role = 'admin'
  ));
