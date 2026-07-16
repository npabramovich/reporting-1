-- Scope key for the unified Analyst's conversations.
--
-- The Analyst now serves per-domain scopes beyond company/deal/portfolio: a vehicle's books
-- ("accounting:<vehicle name>"), the LP domain ("lps"), diligence ("diligence"). Those threads
-- must not blend into one another — nor into the portfolio thread — either in the history list
-- or in the conversation-memory injection that feeds past summaries back into the prompt.
--
-- company_id/deal_id already carve out their own scopes, so this column is only ever set on
-- conversations that would otherwise be portfolio-wide. NULL keeps its existing meaning:
-- portfolio-wide, which is exactly what every pre-existing row is.
alter table analyst_conversations
  add column if not exists scope text;

comment on column analyst_conversations.scope is
  'Domain scope for a conversation that is not company- or deal-scoped: ''accounting:<vehicle>'', ''lps'', ''diligence''. NULL = portfolio-wide.';

-- Mirrors idx_analyst_conv_user_company / _user_deal: every read is "this user''s threads in this
-- scope, newest first".
create index if not exists idx_analyst_conv_user_scope
  on analyst_conversations (user_id, scope, updated_at desc);

-- No grants needed: this ALTERs an existing table, whose grants and RLS policies
-- (20260309100003_tighten_rls_writers.sql) already cover it and are column-agnostic.
