-- Fund API keys — non-cookie authentication so AI agents (and scripts) can call
-- the ledger API and the MCP endpoint on behalf of a fund. Only the SHA-256 hash
-- of each key is stored; the plaintext token is shown once at creation.
--
-- Security note: unlike most tables in this repo, anon gets NO grants here. These
-- rows are credential material and must never be exposed via the anon Data API.

create table public.fund_api_keys (
  id           uuid primary key default gen_random_uuid(),
  fund_id      uuid not null references funds(id) on delete cascade,
  name         text not null,
  key_prefix   text not null,          -- leading chars for display, e.g. "lk_ab12cd34"
  key_hash     text not null unique,   -- sha256 hex of the full token
  scopes       text not null default 'read,write',
  created_by   uuid,
  last_used_at timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz not null default now()
);

-- Grants — deliberately NO anon access (credential material). authenticated +
-- service_role only; RLS narrows to fund admins.
grant select, insert, update, delete on public.fund_api_keys to authenticated, service_role;

alter table public.fund_api_keys enable row level security;

create policy "Fund admins manage their fund's API keys"
  on public.fund_api_keys for all to authenticated
  using (exists (
    select 1 from fund_members fm
    where fm.fund_id = fund_api_keys.fund_id and fm.user_id = auth.uid() and fm.role = 'admin'
  ))
  with check (exists (
    select 1 from fund_members fm
    where fm.fund_id = fund_api_keys.fund_id and fm.user_id = auth.uid() and fm.role = 'admin'
  ));

create index fund_api_keys_hash_idx on public.fund_api_keys (key_hash) where revoked_at is null;
create index fund_api_keys_fund_idx on public.fund_api_keys (fund_id, created_at desc);
