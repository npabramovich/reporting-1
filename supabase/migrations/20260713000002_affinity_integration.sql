-- Affinity CRM integration
--
-- Two capabilities land here:
--   1. Pulling Affinity notes + attached files into a deal's data room, so the
--      memo agent's ingest stage turns them into claims with provenance.
--   2. Giving the diligence assistant live read access to Affinity via tool use.
--
-- Credential model: Affinity issues ONE API KEY PER USER, and that key is scoped
-- to what that user can see in Affinity. So the key is stored per user, not per
-- fund (`affinity_credentials`), and encrypted with the fund's existing DEK
-- (envelope encryption — see 20260227000002_funds.sql). The DATA the key pulls
-- lands in the shared, fund-scoped data room (`diligence_documents`), attributed
-- to the importing user via `uploaded_by`.
--
-- Background sync runs as the user who linked the deal to Affinity
-- (`diligence_deals.affinity_linked_by`) — their key, their visibility.

-- ---------------------------------------------------------------------------
-- AFFINITY_CREDENTIALS — one Affinity API key per user
-- ---------------------------------------------------------------------------

create table if not exists public.affinity_credentials (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null unique references auth.users(id) on delete cascade,
  fund_id               uuid not null references funds(id) on delete cascade,
  -- AES-256-GCM, encrypted with the fund DEK (fund_settings.encryption_key_encrypted).
  api_key_encrypted     text not null,
  -- Denormalized from Affinity's whoami at connect time, so the UI can show
  -- "connected as jane@fund.com" without decrypting and calling out.
  affinity_user_email   text,
  affinity_user_name    text,
  -- Last successful call. A null value after a failure means the key went stale
  -- (revoked in Affinity, or the user lost the permission) — the UI prompts to
  -- reconnect rather than silently syncing nothing.
  last_verified_at      timestamptz,
  last_error            text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index affinity_credentials_fund_id_idx on public.affinity_credentials (fund_id);

-- 1. Grants — required from 2026-05-30 onward for the Data API to see this table.
--    anon gets nothing: this table holds an encrypted third-party credential and
--    is never read from an unauthenticated context.
grant select, insert, update, delete on public.affinity_credentials to authenticated, service_role;

-- 2. RLS.
alter table public.affinity_credentials enable row level security;

-- 3. Policies — a user may only ever see or touch their OWN Affinity key. Fund
--    membership is not enough: another member's key would let them read Affinity
--    records their own permissions don't grant.
drop policy if exists "Users read their own Affinity credential"   on public.affinity_credentials;
drop policy if exists "Users create their own Affinity credential" on public.affinity_credentials;
drop policy if exists "Users update their own Affinity credential" on public.affinity_credentials;
drop policy if exists "Users delete their own Affinity credential" on public.affinity_credentials;

create policy "Users read their own Affinity credential"
  on public.affinity_credentials for select to authenticated
  using (user_id = auth.uid());

create policy "Users create their own Affinity credential"
  on public.affinity_credentials for insert to authenticated
  with check (user_id = auth.uid());

create policy "Users update their own Affinity credential"
  on public.affinity_credentials for update to authenticated
  using (user_id = auth.uid());

create policy "Users delete their own Affinity credential"
  on public.affinity_credentials for delete to authenticated
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- DILIGENCE_DEALS — link a deal to an Affinity organization / opportunity
-- ---------------------------------------------------------------------------

alter table diligence_deals
  add column if not exists affinity_organization_id  bigint,
  add column if not exists affinity_opportunity_id   bigint,
  -- Whose Affinity key the background sync runs as. Set when the deal is linked.
  add column if not exists affinity_linked_by        uuid references auth.users(id),
  add column if not exists affinity_last_synced_at   timestamptz;

-- The sync cron scans for active, linked deals. Partial index keeps it cheap.
create index if not exists diligence_deals_affinity_sync_idx
  on diligence_deals (fund_id, affinity_last_synced_at)
  where affinity_organization_id is not null and deal_status = 'active';

-- ---------------------------------------------------------------------------
-- DILIGENCE_DOCUMENTS — provenance for externally-sourced documents
-- ---------------------------------------------------------------------------
--
-- `drive_file_id` / `drive_source_url` already exist for the Google Drive
-- importer. Affinity gets the same treatment, plus a `source_kind` discriminator
-- so the deal-room UI can badge where a document came from.
--
-- NB: this is deliberately NOT the existing `external_source` column. That one
-- is jsonb and means "the bytes live somewhere other than our bucket" (it holds
-- {bucket: ...} and is read by transcribe-job.ts). Overloading it with a
-- provenance string would break that reader. Different concept, different column.

alter table diligence_documents
  add column if not exists source_kind         text,
  add column if not exists affinity_note_id    bigint,
  add column if not exists affinity_file_id    bigint,
  -- Set by the inbound-email → diligence intake (see the companion migration).
  add column if not exists source_email_id     uuid references inbound_emails(id) on delete set null;

alter table diligence_documents
  drop constraint if exists diligence_documents_source_kind_check;

alter table diligence_documents
  add constraint diligence_documents_source_kind_check
  check (source_kind is null or source_kind in ('upload', 'google_drive', 'affinity', 'email'));

-- Dedupe guards. The importer re-runs on every sync tick and must not re-add a
-- note it already pulled. Partial unique indexes make that a DB invariant rather
-- than a "we checked first" race.
create unique index if not exists diligence_documents_affinity_note_uniq
  on diligence_documents (deal_id, affinity_note_id)
  where affinity_note_id is not null;

create unique index if not exists diligence_documents_affinity_file_uniq
  on diligence_documents (deal_id, affinity_file_id)
  where affinity_file_id is not null;

create index if not exists diligence_documents_source_email_idx
  on diligence_documents (source_email_id)
  where source_email_id is not null;

-- ---------------------------------------------------------------------------
-- FUND_SETTINGS — how the assistant reaches Affinity
-- ---------------------------------------------------------------------------
--
-- Default (false): the diligence assistant gets our own read-only Affinity tools
-- (search companies, read notes, list files) backed by the REST client.
--
-- When true: the assistant instead connects to Affinity's hosted MCP server via
-- Anthropic's MCP connector. That exposes Affinity's full tool surface — which
-- INCLUDES WRITES, so the model can log notes back into the fund's CRM. It also
-- requires an Affinity Scale/Advanced/Enterprise plan and an Anthropic model.
-- Opt-in for exactly those reasons.
alter table fund_settings
  add column if not exists affinity_mcp_enabled boolean not null default false;

-- ---------------------------------------------------------------------------
-- MEMO_AGENT_JOBS — new 'affinity_sync' job kind
-- ---------------------------------------------------------------------------
--
-- Long-running Affinity pulls run through the existing DB-backed queue drained
-- by /api/cron/memo-agent-worker, exactly like ingest/research/draft.

alter table memo_agent_jobs
  drop constraint if exists memo_agent_jobs_kind_check;

alter table memo_agent_jobs
  add constraint memo_agent_jobs_kind_check
  check (kind in (
    'ingest',
    'ingest_synthesis',
    'research',
    'qa',
    'draft',
    'draft_review',
    'score',
    'render',
    'transcribe',
    'checklist_assessment',
    'affinity_sync'
  ));
