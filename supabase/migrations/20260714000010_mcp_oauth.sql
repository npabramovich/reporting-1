-- OAuth 2.1 authorization server for the MCP endpoint.
--
-- WHY THIS EXISTS: the MCP spec requires remote servers to be OAuth 2.1 resource
-- servers, and Claude's custom-connector flow begins with Dynamic Client
-- Registration (RFC 7591) — it self-registers and discovers everything else. Our
-- MCP endpoint previously accepted ONLY a static `lk_` bearer key, so that flow
-- died at discovery with "couldn't register with the sign-in service". The static
-- keys keep working (CLI clients use them); this adds the browser path.
--
-- We are both the authorization server and the resource server. That is the
-- simple, correct shape here: the resource owner is already authenticated by
-- Supabase Auth in this very app, so there is no third party to federate with.
--
-- THREE TABLES:
--   oauth_clients              — apps that registered (Claude, primarily)
--   oauth_authorization_codes  — short-lived, single-use, PKCE-bound
--   oauth_tokens               — access + refresh tokens (hashes only)
--
-- SECRETS AT REST: every credential here is stored as a SHA-256 hash and never in
-- plaintext, exactly like `fund_api_keys.key_hash`. Unsalted SHA-256 is correct
-- for these (unlike passwords) — each is 32 bytes of CSPRNG output, so there is no
-- dictionary to attack — and the lookup must be deterministic.

-- ---------------------------------------------------------------------------
-- FUND_SETTINGS — the master switch for the whole agent surface
-- ---------------------------------------------------------------------------
--
-- One admin-only flag gates EVERYTHING an external agent can reach: the MCP
-- endpoint (OAuth and static-key alike), the REST agent endpoint, API-key
-- creation, and the OAuth consent screen. A fund that doesn't want its ledger
-- reachable by an agent flips this off and the entire surface goes dark —
-- including keys and tokens that were already issued.
--
-- DEFAULT FALSE: a capability that can post journal entries should be opt-in, and
-- a fresh install should not ship with its ledger exposed to anyone holding a key.
--
-- ...but flipping it off under funds that are ALREADY using their keys would be a
-- silent breaking change, so the backfill below switches it on for any fund that
-- has a live (non-revoked) API key. In other words: nobody who is using this today
-- loses it, and nobody who isn't gets it by default.
alter table fund_settings
  add column if not exists agent_api_enabled boolean not null default false;

update fund_settings fs
   set agent_api_enabled = true
 where exists (
   select 1 from fund_api_keys k
    where k.fund_id = fs.fund_id
      and k.revoked_at is null
 );

-- ---------------------------------------------------------------------------
-- OAUTH_CLIENTS
-- ---------------------------------------------------------------------------
--
-- Registration is PUBLIC and unauthenticated, as RFC 7591 requires for the MCP
-- flow. That is safe because a client_id grants nothing on its own: it cannot
-- read a byte of data until a real human logs in at /oauth/authorize and consents,
-- and the resulting token is scoped to THAT person's fund and role. A registered
-- client with no authorization is inert.

create table if not exists public.oauth_clients (
  client_id                   text primary key,

  -- Null for PUBLIC clients (token_endpoint_auth_method = 'none'), which is what
  -- Claude registers as: a browser-driven client cannot keep a secret, so it
  -- proves itself with PKCE instead. Confidential clients get a hashed secret.
  client_secret_hash          text,

  client_name                 text,
  client_uri                  text,
  logo_uri                    text,

  -- Exact-match allowlist. The token endpoint and the authorize endpoint both
  -- check the supplied redirect_uri against this array verbatim — no prefix
  -- matching, no wildcards. This is the single most important field in the table:
  -- a loose match here is an open redirect that leaks authorization codes.
  redirect_uris               text[] not null default '{}',

  grant_types                 text[] not null default '{authorization_code,refresh_token}',
  response_types              text[] not null default '{code}',
  token_endpoint_auth_method  text not null default 'none'
                                check (token_endpoint_auth_method in ('none', 'client_secret_post', 'client_secret_basic')),
  scope                       text not null default 'read',

  created_at                  timestamptz not null default now()
);

-- 1. Grants — SERVICE ROLE ONLY. Neither anon nor authenticated gets anything.
--    This table holds `client_secret_hash`, and every read in the app goes through
--    the service-role client (lib/oauth/store.ts). Granting `authenticated` a
--    select — even a read-only one — would publish every registered client's
--    secret hash to any logged-in user over the Data API, for no benefit at all,
--    since nothing in a user context ever reads this table.
grant select, insert, update, delete on public.oauth_clients to service_role;

-- 2. RLS. Enabled with NO policies: belt and braces behind the absent grants, so
--    a future grant added by mistake still can't read a row.
alter table public.oauth_clients enable row level security;

-- ---------------------------------------------------------------------------
-- OAUTH_AUTHORIZATION_CODES
-- ---------------------------------------------------------------------------
--
-- Issued when a human approves the consent screen; exchanged once, immediately,
-- for tokens. Everything about this row is a guard rail:
--   * code_hash        — the code itself is never stored
--   * code_challenge   — PKCE S256 is REQUIRED (see the check below)
--   * redirect_uri     — the token exchange must present the SAME uri
--   * consumed_at      — single use; a replayed code is refused
--   * expires_at       — 60s in practice; the spec allows 10 min, but the code
--                        travels only from our redirect to the client's callback

create table if not exists public.oauth_authorization_codes (
  id                    uuid primary key default gen_random_uuid(),
  code_hash             text not null unique,

  client_id             text not null references oauth_clients(client_id) on delete cascade,
  user_id               uuid not null references auth.users(id) on delete cascade,
  -- The fund the resulting token will be bound to, captured at consent time.
  fund_id               uuid not null references funds(id) on delete cascade,

  redirect_uri          text not null,
  scope                 text not null default 'read',

  -- PKCE. 'plain' is deliberately NOT allowed: OAuth 2.1 requires S256, and
  -- accepting 'plain' would let anyone who intercepts the authorization request
  -- replay the challenge.
  code_challenge        text not null,
  code_challenge_method text not null default 'S256' check (code_challenge_method = 'S256'),

  -- RFC 8707 resource indicator — which MCP endpoint this code is for. Bound into
  -- the token so an access token minted for us can't be replayed at some other
  -- resource that trusts the same issuer.
  resource              text,

  expires_at            timestamptz not null,
  consumed_at           timestamptz,
  created_at            timestamptz not null default now()
);

create index if not exists oauth_authorization_codes_expiry_idx
  on public.oauth_authorization_codes (expires_at);

grant select, insert, update, delete on public.oauth_authorization_codes to service_role;

alter table public.oauth_authorization_codes enable row level security;
-- No policies at all: this table is service-role only. Authorization codes are
-- bearer credentials in flight, and nothing in a user context has any business
-- reading them — not even their own.

-- ---------------------------------------------------------------------------
-- OAUTH_TOKENS — access + refresh
-- ---------------------------------------------------------------------------

create table if not exists public.oauth_tokens (
  id                    uuid primary key default gen_random_uuid(),
  token_hash            text not null unique,
  kind                  text not null check (kind in ('access', 'refresh')),

  client_id             text not null references oauth_clients(client_id) on delete cascade,
  user_id               uuid not null references auth.users(id) on delete cascade,

  -- The token is HARD-BOUND to one fund, captured from the owner's membership at
  -- consent time. The MCP route builds its tool context from this column and never
  -- from the request body, which is what makes cross-fund access impossible.
  fund_id               uuid not null references funds(id) on delete cascade,

  -- 'read' or 'read write'. NOTE this is a grant ceiling, not the final say: every
  -- write tool ALSO re-reads the owner's fund_members.role live on each call
  -- (authorizeToolUse), so demoting an admin instantly disarms their existing
  -- write tokens without anyone having to hunt them down and revoke them.
  scope                 text not null default 'read',

  resource              text,

  -- Refresh-token rotation. On use, a refresh token is revoked and its successor
  -- recorded here. If a REVOKED refresh token is ever presented again, that means
  -- it leaked and was replayed — we revoke the entire chain for that client+user.
  replaced_by           uuid references public.oauth_tokens(id) on delete set null,

  expires_at            timestamptz not null,
  revoked_at            timestamptz,
  last_used_at          timestamptz,
  created_at            timestamptz not null default now()
);

create index if not exists oauth_tokens_user_idx    on public.oauth_tokens (user_id, kind);
create index if not exists oauth_tokens_client_idx  on public.oauth_tokens (client_id, user_id);
create index if not exists oauth_tokens_expiry_idx  on public.oauth_tokens (expires_at) where revoked_at is null;

grant select, delete on public.oauth_tokens to authenticated;
grant select, insert, update, delete on public.oauth_tokens to service_role;

alter table public.oauth_tokens enable row level security;

-- A user may SEE and REVOKE their own connected-app tokens (so a "Connected apps"
-- list can exist, and so revocation is self-service). They may never see anyone
-- else's, and they can never mint one — issuing is service-role only.
drop policy if exists "Users read their own OAuth tokens"   on public.oauth_tokens;
drop policy if exists "Users revoke their own OAuth tokens" on public.oauth_tokens;

create policy "Users read their own OAuth tokens"
  on public.oauth_tokens for select to authenticated
  using (user_id = auth.uid());

create policy "Users revoke their own OAuth tokens"
  on public.oauth_tokens for delete to authenticated
  using (user_id = auth.uid());
