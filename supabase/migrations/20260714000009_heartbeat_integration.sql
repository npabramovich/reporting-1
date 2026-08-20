-- Heartbeat community integration — new threads in a watched channel become deals.
--
-- Heartbeat (https://heartbeat.chat) organizes a community into CHANNELS that
-- contain THREADS. A fund that runs its dealflow through a Heartbeat community
-- wants a new thread in, say, #new-deals to land in /deals like an emailed pitch.
--
-- Transport: Heartbeat supports a THREAD_CREATE webhook, optionally filtered to a
-- single channel. It delivers only `{ id, channelID }`, so we call
-- GET /threads/{id} to fetch the content, then run it through the SAME
-- processDeal pipeline as email / the manual form / the public submit form.
--
-- Credential model — deliberately different from Affinity: a Heartbeat API key is
-- issued at the COMMUNITY level, not per user, and it authorizes reading every
-- channel the community has. There is no per-user scoping to preserve, so the key
-- is stored ONCE PER FUND and only an admin may set it. (Affinity's key is per
-- user precisely because it IS permission-scoped — see 20260713000002.)
--
-- Encryption follows the repo's envelope pattern: the key is AES-256-GCM encrypted
-- with the fund's DEK, and the DEK is wrapped under the master KEK in
-- process.env.ENCRYPTION_KEY.

-- ---------------------------------------------------------------------------
-- INBOUND_DEALS — 'heartbeat' becomes a valid intro_source
-- ---------------------------------------------------------------------------
--
-- intro_source means "how the founder reached us", which is exactly what this is:
-- they posted in our community, the same way 'demo_day' or 'event' means they met
-- us there. It is NOT added to the deal analyzer's allowed values — the LLM must
-- never be able to guess 'heartbeat' for an emailed pitch. Only the Heartbeat
-- ingest path sets it, by overriding the analyzer's answer.

alter table inbound_deals
  drop constraint if exists inbound_deals_intro_source_check;

alter table inbound_deals
  add constraint inbound_deals_intro_source_check
  check (intro_source is null or intro_source in (
    'referral', 'cold', 'warm_intro', 'accelerator',
    'demo_day', 'event', 'heartbeat', 'other'
  ));

-- The Deals UI only offers "Heartbeat" as a source filter when the integration is
-- connected OR a deal has actually arrived through it. This partial index makes
-- that second existence check a cheap lookup instead of a scan.
create index if not exists inbound_deals_heartbeat_source_idx
  on inbound_deals (fund_id)
  where intro_source = 'heartbeat';

-- ---------------------------------------------------------------------------
-- HEARTBEAT_CREDENTIALS — one Heartbeat connection per fund
-- ---------------------------------------------------------------------------

create table if not exists public.heartbeat_credentials (
  id                      uuid primary key default gen_random_uuid(),
  fund_id                 uuid not null unique references funds(id) on delete cascade,

  -- AES-256-GCM, encrypted with the fund DEK (fund_settings.encryption_key_encrypted).
  api_key_encrypted       text not null,

  -- Heartbeat's webhooks carry NO signature header and NO shared secret — the
  -- docs describe no verification mechanism at all. So the receiving route
  -- authenticates on a high-entropy token embedded in the URL we register with
  -- Heartbeat (/api/webhooks/heartbeat/<token>).
  --
  -- The token is stored TWICE, because the two jobs need different properties:
  --
  --   webhook_secret_hash — SHA-256. The webhook route hashes the token it was
  --   called with and looks the fund up by it. This must be DETERMINISTIC, which
  --   rules out encrypt() (AES-GCM uses a random IV, so the same token encrypts
  --   differently every time and could never be matched).
  --
  --   webhook_secret_encrypted — AES-256-GCM under the fund DEK. Reversible, so
  --   the server can rebuild the webhook URL when an admin adds a channel later,
  --   without re-minting the token and forcing them to re-enter the API key.
  --
  -- Neither column stores the token in the clear.
  webhook_secret_hash     text not null unique,
  webhook_secret_encrypted text not null,

  -- Master switch. Disconnecting deletes the row; this flag lets an admin pause
  -- ingestion without discarding the key and re-registering every webhook.
  enabled                 boolean not null default true,

  -- Last successful call. A non-null last_error means the key went stale (revoked
  -- in Heartbeat) — the UI prompts to reconnect rather than silently ingesting
  -- nothing forever.
  last_verified_at        timestamptz,
  last_error              text,

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

-- The webhook route's only lookup: hash the URL token, find the fund.
create index if not exists heartbeat_credentials_webhook_secret_idx
  on public.heartbeat_credentials (webhook_secret_hash);

-- 1. Grants. anon gets nothing: this table holds an encrypted third-party
--    credential and is never read from an unauthenticated Data API context. (The
--    webhook route reads it via the service-role client, not as anon.)
grant select, insert, update, delete on public.heartbeat_credentials to authenticated, service_role;

-- 2. RLS.
alter table public.heartbeat_credentials enable row level security;

-- 3. Policies — admins of the fund only. Unlike the Affinity key, this one is a
--    fund-wide credential that can read every channel in the community, so it is
--    gated on role rather than on "it's yours".
drop policy if exists "Fund admins read the Heartbeat credential"   on public.heartbeat_credentials;
drop policy if exists "Fund admins create the Heartbeat credential" on public.heartbeat_credentials;
drop policy if exists "Fund admins update the Heartbeat credential" on public.heartbeat_credentials;
drop policy if exists "Fund admins delete the Heartbeat credential" on public.heartbeat_credentials;

create policy "Fund admins read the Heartbeat credential"
  on public.heartbeat_credentials for select to authenticated
  using (exists (
    select 1 from fund_members fm
    where fm.fund_id = heartbeat_credentials.fund_id
      and fm.user_id = auth.uid()
      and fm.role = 'admin'
  ));

create policy "Fund admins create the Heartbeat credential"
  on public.heartbeat_credentials for insert to authenticated
  with check (exists (
    select 1 from fund_members fm
    where fm.fund_id = heartbeat_credentials.fund_id
      and fm.user_id = auth.uid()
      and fm.role = 'admin'
  ));

create policy "Fund admins update the Heartbeat credential"
  on public.heartbeat_credentials for update to authenticated
  using (exists (
    select 1 from fund_members fm
    where fm.fund_id = heartbeat_credentials.fund_id
      and fm.user_id = auth.uid()
      and fm.role = 'admin'
  ));

create policy "Fund admins delete the Heartbeat credential"
  on public.heartbeat_credentials for delete to authenticated
  using (exists (
    select 1 from fund_members fm
    where fm.fund_id = heartbeat_credentials.fund_id
      and fm.user_id = auth.uid()
      and fm.role = 'admin'
  ));

-- ---------------------------------------------------------------------------
-- HEARTBEAT_CHANNELS — which channels an admin has opted into
-- ---------------------------------------------------------------------------
--
-- Ingestion is OPT-IN PER CHANNEL and defaults to nothing. A Heartbeat community
-- is a firehose — #introductions, #general, #wins — and turning every thread in it
-- into a deal would bury the real dealflow. The admin names the channels that
-- carry pitches; the rest are never read.
--
-- One Heartbeat webhook is registered per watched channel (THREAD_CREATE takes an
-- optional channel filter), so we keep the webhook's ID to delete it again when
-- the channel is unwatched or the integration is disconnected. Leaving orphaned
-- webhooks pointed at a dead URL would have Heartbeat retrying forever.

create table if not exists public.heartbeat_channels (
  id                      uuid primary key default gen_random_uuid(),
  fund_id                 uuid not null references funds(id) on delete cascade,

  -- Heartbeat's own IDs (UUID strings in their API, kept as text).
  channel_id              text not null,
  channel_name            text,

  -- The THREAD_CREATE webhook registered for this channel, so we can delete it.
  -- Null means "watched, but webhook registration failed" — the hourly backfill
  -- poll still covers the channel, which is why a failure here is not fatal.
  webhook_id              text,

  -- Bound for the backfill poll: threads older than this were posted before the
  -- channel was watched and are deliberately NOT imported. Without it, connecting
  -- the integration would retroactively create a deal for every old thread.
  watch_started_at        timestamptz not null default now(),
  last_polled_at          timestamptz,

  created_at              timestamptz not null default now(),

  unique (fund_id, channel_id)
);

create index if not exists heartbeat_channels_fund_idx on public.heartbeat_channels (fund_id);

grant select on public.heartbeat_channels to anon;
grant select, insert, update, delete on public.heartbeat_channels to authenticated, service_role;

alter table public.heartbeat_channels enable row level security;

drop policy if exists "Fund members read watched Heartbeat channels" on public.heartbeat_channels;
drop policy if exists "Fund admins manage watched Heartbeat channels" on public.heartbeat_channels;

-- Any member may SEE which channels feed the deal pipeline (it explains where a
-- deal came from); only an admin may change the set.
create policy "Fund members read watched Heartbeat channels"
  on public.heartbeat_channels for select to authenticated
  using (exists (
    select 1 from fund_members fm
    where fm.fund_id = heartbeat_channels.fund_id and fm.user_id = auth.uid()
  ));

create policy "Fund admins manage watched Heartbeat channels"
  on public.heartbeat_channels for all to authenticated
  using (exists (
    select 1 from fund_members fm
    where fm.fund_id = heartbeat_channels.fund_id
      and fm.user_id = auth.uid()
      and fm.role = 'admin'
  ))
  with check (exists (
    select 1 from fund_members fm
    where fm.fund_id = heartbeat_channels.fund_id
      and fm.user_id = auth.uid()
      and fm.role = 'admin'
  ));

-- ---------------------------------------------------------------------------
-- HEARTBEAT_THREADS — the dedupe ledger
-- ---------------------------------------------------------------------------
--
-- The webhook and the hourly backfill poll are deliberately REDUNDANT: the
-- webhook is fast, the poll is the safety net for threads posted while the app
-- was down or the webhook was misregistered. Redundant delivery means the same
-- thread will routinely arrive twice, so "have we already made a deal from this
-- thread?" has to be a DB invariant, not a "we checked first" race.
--
-- The unique constraint is that invariant. Both paths insert here BEFORE running
-- the analyzer; a duplicate insert fails, and that path stops. This also means a
-- thread that was seen but produced no deal (analyzer failed, or it wasn't a
-- pitch) is remembered as seen and not retried forever.

create table if not exists public.heartbeat_threads (
  id                      uuid primary key default gen_random_uuid(),
  fund_id                 uuid not null references funds(id) on delete cascade,

  thread_id               text not null,
  channel_id              text not null,

  -- The deal this thread became, if it became one.
  deal_id                 uuid references inbound_deals(id) on delete set null,
  -- The synthetic inbound_emails row processDeal requires as its FK. Kept so the
  -- thread is traceable in /audit exactly like an emailed deal.
  email_id                uuid references inbound_emails(id) on delete set null,

  status                  text not null default 'pending'
                            check (status in ('pending', 'imported', 'failed')),
  error                   text,

  thread_created_at       timestamptz,
  created_at              timestamptz not null default now(),

  -- The invariant. One deal per Heartbeat thread, forever.
  unique (fund_id, thread_id)
);

create index if not exists heartbeat_threads_fund_idx on public.heartbeat_threads (fund_id, created_at desc);
create index if not exists heartbeat_threads_deal_idx on public.heartbeat_threads (deal_id) where deal_id is not null;

grant select on public.heartbeat_threads to anon;
grant select, insert, update, delete on public.heartbeat_threads to authenticated, service_role;

alter table public.heartbeat_threads enable row level security;

drop policy if exists "Fund members read Heartbeat threads"  on public.heartbeat_threads;
drop policy if exists "Fund admins manage Heartbeat threads" on public.heartbeat_threads;

create policy "Fund members read Heartbeat threads"
  on public.heartbeat_threads for select to authenticated
  using (exists (
    select 1 from fund_members fm
    where fm.fund_id = heartbeat_threads.fund_id and fm.user_id = auth.uid()
  ));

create policy "Fund admins manage Heartbeat threads"
  on public.heartbeat_threads for all to authenticated
  using (exists (
    select 1 from fund_members fm
    where fm.fund_id = heartbeat_threads.fund_id
      and fm.user_id = auth.uid()
      and fm.role = 'admin'
  ))
  with check (exists (
    select 1 from fund_members fm
    where fm.fund_id = heartbeat_threads.fund_id
      and fm.user_id = auth.uid()
      and fm.role = 'admin'
  ));
