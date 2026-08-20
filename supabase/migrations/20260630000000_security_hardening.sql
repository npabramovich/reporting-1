-- Security hardening follow-up (audit 2026-06-30).
--
-- 1. Lock three SECURITY DEFINER helper RPCs to the service role and pin their
--    search_path. Postgres/PostgREST exposes every public-schema function to the
--    anon/authenticated roles by default; these definer functions bypass RLS and
--    take caller-supplied parameters, so a logged-in (or anonymous) client could
--    invoke them directly via the Data API. Their only legitimate callers use the
--    service-role client, which retains EXECUTE via Supabase's default grant
--    (same pattern as 20260509000002_memo_agent_jobs_lockdown.sql).
-- 2. Stop exposing the app_settings secret columns to authenticated users.

-- is_fund_member_by_email(uuid, text): returns user_id + role for any fund/email
-- → unauthenticated cross-tenant membership/role disclosure.
revoke execute on function public.is_fund_member_by_email(uuid, text) from public, anon, authenticated;
alter function public.is_fund_member_by_email(uuid, text) set search_path = public, pg_temp;

-- count_unread_notes(uuid): accepts an arbitrary user_id and bypasses RLS,
-- leaking any user's unread-note count.
revoke execute on function public.count_unread_notes(uuid) from public, anon, authenticated;
alter function public.count_unread_notes(uuid) set search_path = public, pg_temp;

-- rate_limit_check(text, int, int): SECURITY DEFINER with a mutable search_path.
revoke execute on function public.rate_limit_check(text, int, int) from public, anon, authenticated;
alter function public.rate_limit_check(text, int, int) set search_path = public, pg_temp;

-- app_settings: the SELECT policy lets every authenticated user (now including
-- LP-portal logins) read the whole row, including the inbound-email token. Drop
-- table-level SELECT for anon/authenticated and re-grant only the non-secret
-- columns. Server code reads this table via the service-role client (which keeps
-- full access), so the inbound pipeline and admin UI are unaffected.
revoke select on table public.app_settings from anon, authenticated;
grant select (id, global_inbound_address, github_stars, github_stars_checked_at, installation_id, created_at, updated_at)
  on table public.app_settings to authenticated;

-- Clear any legacy plaintext inbound token that has already been migrated to the
-- encrypted column (left intact where the encrypted value isn't populated yet so
-- those deployments keep working until they migrate).
update public.app_settings
set global_inbound_token = null
where global_inbound_token is not null
  and global_inbound_token_encrypted is not null;
