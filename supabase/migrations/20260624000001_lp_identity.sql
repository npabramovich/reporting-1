-- LP identity & access graph (Phase 1 of LP reporting).
--
-- LPs span multiple funds and authorized users span multiple LPs, so LPs do NOT
-- go in fund_members (which enforces one-fund-per-user for GPs). Instead this is
-- a separate, parallel access graph. GP-side resolution (fund_members, the
-- single-fund invariant, get_my_fund_ids) is untouched.
--
-- A single auth.users row MAY be both a GP member and an LP. The two graphs are
-- independent and never merged — which one applies is resolved by route context
-- (/app via fund_members, /portal via lp_accounts). See BUILD-PLAN A1.
--
-- Grants posture: these are private identity tables. authenticated gets SELECT
-- only (RLS scopes it to the caller's own rows); all writes go through the admin
-- (service_role) client with manual scoping, per the repo's data-access
-- convention. No anon access — the Data API never serves these unauthenticated.

-- ---------------------------------------------------------------------------
-- lp_accounts — one row per external LP login.
-- ---------------------------------------------------------------------------
create table public.lp_accounts (
  id            uuid        primary key default gen_random_uuid(),
  -- Bound to the auth user on first portal onboarding; null while invited.
  auth_user_id  uuid        references auth.users(id) on delete set null,
  kind          text        not null default 'lp' check (kind in ('lp', 'authorized_user')),
  email         text        not null,
  display_name  text,
  status        text        not null default 'invited' check (status in ('invited', 'active', 'disabled')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index lp_accounts_email_key on public.lp_accounts (lower(email));
create unique index lp_accounts_auth_user_key on public.lp_accounts (auth_user_id) where auth_user_id is not null;

grant select on public.lp_accounts to authenticated;
grant select, insert, update, delete on public.lp_accounts to service_role;

alter table public.lp_accounts enable row level security;

-- An LP can read only their own account row.
create policy lp_accounts_select_own on public.lp_accounts
  for select to authenticated
  using (auth_user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- lp_account_links — which lp_investor (per fund) an account may see.
-- This is the join that lets a logged-in LP resolve "my rows" in a snapshot.
-- ---------------------------------------------------------------------------
create table public.lp_account_links (
  id              uuid        primary key default gen_random_uuid(),
  lp_account_id   uuid        not null references lp_accounts(id) on delete cascade,
  fund_id         uuid        not null references funds(id) on delete cascade,
  lp_investor_id  uuid        not null references lp_investors(id) on delete cascade,
  created_at      timestamptz not null default now(),
  created_by      uuid        references auth.users(id) on delete set null,
  unique (lp_account_id, fund_id, lp_investor_id)
);
create index lp_account_links_account_idx on public.lp_account_links (lp_account_id);
create index lp_account_links_investor_idx on public.lp_account_links (lp_investor_id);

grant select on public.lp_account_links to authenticated;
grant select, insert, update, delete on public.lp_account_links to service_role;

alter table public.lp_account_links enable row level security;

-- An LP can read only links that belong to their own account.
create policy lp_account_links_select_own on public.lp_account_links
  for select to authenticated
  using (lp_account_id in (select id from public.lp_accounts where auth_user_id = auth.uid()));

-- ---------------------------------------------------------------------------
-- lp_authorized_users — which authorized-user account acts for which principal LP.
-- ---------------------------------------------------------------------------
create table public.lp_authorized_users (
  id                          uuid        primary key default gen_random_uuid(),
  authorized_user_account_id  uuid        not null references lp_accounts(id) on delete cascade,
  principal_lp_account_id     uuid        not null references lp_accounts(id) on delete cascade,
  lp_investor_id              uuid        not null references lp_investors(id) on delete cascade,
  created_at                  timestamptz not null default now(),
  created_by                  uuid        references auth.users(id) on delete set null,
  unique (authorized_user_account_id, principal_lp_account_id, lp_investor_id)
);
create index lp_authorized_users_auth_idx on public.lp_authorized_users (authorized_user_account_id);
create index lp_authorized_users_principal_idx on public.lp_authorized_users (principal_lp_account_id);

grant select on public.lp_authorized_users to authenticated;
grant select, insert, update, delete on public.lp_authorized_users to service_role;

alter table public.lp_authorized_users enable row level security;

-- A user can read delegation rows where they are either the authorized user or the principal.
create policy lp_authorized_users_select_own on public.lp_authorized_users
  for select to authenticated
  using (
    authorized_user_account_id in (select id from public.lp_accounts where auth_user_id = auth.uid())
    or principal_lp_account_id in (select id from public.lp_accounts where auth_user_id = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- get_my_lp_investor_ids() — the LP-side mirror of get_my_fund_ids().
-- Returns every lp_investor_id the current auth user may see: direct links for
-- their own active lp_account, plus links delegated to them as an authorized
-- user. Used by RLS on snapshot/letter data (Phase 2+) as defense-in-depth.
-- ---------------------------------------------------------------------------
create function public.get_my_lp_investor_ids()
returns uuid[]
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(array_agg(distinct lp_investor_id), '{}')
  from (
    select l.lp_investor_id
    from lp_account_links l
    join lp_accounts a on a.id = l.lp_account_id
    where a.auth_user_id = auth.uid() and a.status = 'active'
    union
    select au.lp_investor_id
    from lp_authorized_users au
    join lp_accounts a on a.id = au.authorized_user_account_id
    where a.auth_user_id = auth.uid() and a.status = 'active'
  ) t;
$$;
