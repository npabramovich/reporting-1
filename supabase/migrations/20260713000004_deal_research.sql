-- Deal screening — external web research enrichment
--
-- After an inbound deal is scored against the fund's thesis, we optionally do a
-- round of external research on the founder and the company (who are they, what
-- have they built before, is the traction claim corroborated, any red flags) and
-- attach it to the deal.
--
-- This is GATED, deliberately. Web search costs real money per call (~$10 per
-- 1,000 searches on top of tokens) and an inbound VC mailbox is mostly noise —
-- researching every cold pitch would burn the budget on spam. So research only
-- runs for deals that already look interesting: `deal_research_min_fit` sets the
-- bar (default: 'moderate', i.e. moderate + strong).
--
-- It also runs ASYNCHRONOUSLY. A web-search round can take 30-60s; doing it
-- inline in the inbound-email webhook would risk blowing the function's time
-- limit and marking a perfectly good email as failed. Instead the deal is marked
-- 'pending' and /api/cron/deal-research drains the queue.

alter table inbound_deals
  add column if not exists research_status    text,
  add column if not exists research_summary   text,
  -- Structured findings: founder background, prior companies, corroborated
  -- traction, market context, red flags.
  add column if not exists research_findings  jsonb,
  -- [{url, title}] — what the model actually cited, so a partner can check it.
  add column if not exists research_sources   jsonb,
  add column if not exists research_error     text,
  add column if not exists researched_at      timestamptz;

alter table inbound_deals
  drop constraint if exists inbound_deals_research_status_check;

alter table inbound_deals
  add constraint inbound_deals_research_status_check
  check (research_status is null or research_status in (
    'pending',    -- queued; the cron will pick it up
    'running',    -- claimed by a worker
    'done',
    'failed',
    'skipped'     -- didn't clear the interest bar, or research is disabled
  ));

-- The cron scans for due work. Partial index keeps that scan cheap as the deals
-- table grows.
create index if not exists inbound_deals_research_pending_idx
  on inbound_deals (research_status, created_at)
  where research_status in ('pending', 'running');

-- ---------------------------------------------------------------------------
-- fund_settings — the gate
-- ---------------------------------------------------------------------------

alter table fund_settings
  -- Off by default: this spends money, so it's opt-in per fund.
  add column if not exists deal_research_enabled  boolean not null default false,
  -- Minimum thesis fit that justifies the spend.
  add column if not exists deal_research_min_fit  text not null default 'moderate';

alter table fund_settings
  drop constraint if exists fund_settings_deal_research_min_fit_check;

alter table fund_settings
  add constraint fund_settings_deal_research_min_fit_check
  check (deal_research_min_fit in ('strong', 'moderate', 'weak'));
