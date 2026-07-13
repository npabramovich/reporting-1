-- Repair: `fund_settings.affinity_mcp_enabled` never landed.
--
-- WHAT HAPPENED. 20260713000002_affinity_integration.sql creates its index at line 41
-- as a bare `create index affinity_credentials_fund_id_idx ...` — no `if not exists`.
-- Every other object in that file is guarded, so the file is idempotent right up until
-- that line, where a re-run raises "affinity_credentials_fund_id_idx already exists"
-- and aborts. Everything BEFORE it was already in place; everything after line 41 that
-- wasn't already applied — notably the `affinity_mcp_enabled` column at line 146 —
-- never got there.
--
-- Verified against the database: affinity_credentials, diligence_deals.affinity_*, and
-- diligence_documents.affinity_* all exist; fund_settings.affinity_mcp_enabled does not.
--
-- We do not edit the historical migration (repo convention: applied migrations are
-- immutable, and the CLI tracks them by filename hash). This adds the one missing
-- column, idempotently.
--
-- To stop the CLI retrying the aborted file, mark it applied before the next push:
--     supabase migration repair --status applied 20260713000002
--     supabase db push
--
-- No grants block: this alters an existing table already covered by
-- 20260513000000_data_api_grants_backfill.sql, and leaves RLS/policies as-is.

alter table public.fund_settings
  add column if not exists affinity_mcp_enabled boolean not null default false;

comment on column public.fund_settings.affinity_mcp_enabled is
  'When true the diligence assistant reaches Affinity through Affinity''s hosted MCP server (lists, fields, relationship data) instead of this app''s three built-in REST tools (search, notes, files). Fund-wide, but each member still authenticates with their OWN Affinity key, so the assistant can never surface a CRM record that user could not open themselves.';
