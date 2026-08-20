-- Fund API keys — non-cookie authentication so AI agents (and scripts) can call
-- the ledger API and the MCP endpoint. Keys are PER-USER: each key is owned by a
-- fund member and acts as that member (reads for any member, writes for admins),
-- so a key never grants more than its owner has. Only the SHA-256 hash is stored;
-- the plaintext token is shown once at creation.
--
-- Security note: unlike most tables in this repo, anon gets NO grants here. These
-- rows are credential material and must never be exposed via the anon Data API.

create table public.fund_api_keys (
  id           uuid primary key default gen_random_uuid(),
  fund_id      uuid not null references funds(id) on delete cascade,
  user_id      uuid not null,          -- the owning fund member; the key acts as this user
  name         text not null,
  key_prefix   text not null,          -- leading chars for display, e.g. "lk_ab12cd34"
  key_hash     text not null unique,   -- sha256 hex of the full token
  scopes       text not null default 'read',
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);

-- Grants — deliberately NO anon access (credential material). authenticated +
-- service_role only; RLS narrows to each user's own keys.
grant select, insert, update, delete on public.fund_api_keys to authenticated, service_role;

alter table public.fund_api_keys enable row level security;

-- Each user manages only their OWN keys, and only within a fund they belong to.
create policy "Users manage their own fund API keys"
  on public.fund_api_keys for all to authenticated
  using (
    user_id = auth.uid()
    and exists (select 1 from fund_members fm where fm.fund_id = fund_api_keys.fund_id and fm.user_id = auth.uid())
  )
  with check (
    user_id = auth.uid()
    and exists (select 1 from fund_members fm where fm.fund_id = fund_api_keys.fund_id and fm.user_id = auth.uid())
  );

create index fund_api_keys_hash_idx on public.fund_api_keys (key_hash) where revoked_at is null;
create index fund_api_keys_fund_user_idx on public.fund_api_keys (fund_id, user_id, created_at desc);
