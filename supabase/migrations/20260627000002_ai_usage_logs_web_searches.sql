-- Track Anthropic web_search tool invocations so the research stage's search
-- fees (~$10 / 1,000 searches) are reflected in per-deal and fund-wide cost
-- estimates, on top of token cost.
--
-- New column on an existing table (ai_usage_logs already carries grants + RLS),
-- so no new Data API grants are required.
alter table public.ai_usage_logs
  add column if not exists web_searches integer not null default 0;
