-- What the quarterly ILPA Reporting Template (lib/lp-templates/reporting.ts) needs that the books don't say.
--
--   1. chart_of_accounts.ilpa_category — the Reporting Template line an income or expense account's
--      postings land on (lib/lp-templates/reporting-types.ts ACCOUNT_CATEGORIES). Null means "by the
--      account's subtype" (lib/lp-templates/taxonomy.ts defaultAccountCategory), so every existing account
--      keeps reporting where it does until someone gives it a category.
--   2. portfolio_company_fees: ILPA's full list of fees the adviser receives from portfolio
--      companies (B.1), not just the four the fee schedule offset first, plus the part of a fee
--      that belongs to affiliated positions (co-investors managed by the adviser), which B.1 states
--      in its own column.
--   3. carry_escrow_events — carried interest paid into or released from a third-party escrow.
--      Escrow sits outside the fund's books, so the template's "Amount Held in Escrow" balance
--      has nowhere else to come from.
--   4. A compliance item for delivering the template: 60 days after Q1 to Q3, 120 after Q4.
--
-- ADDITIVE AND SAFE BEFORE DEPLOY. A nullable column, a widened check, a nullable column, a new
-- table and a reference row. Push it before this release: the release reads ilpa_category from
-- the chart, writes the new fee kinds and affiliated_amount, and reads and writes the escrow table.

-- 1. ─────────────────────────────────────────────────────────────────────────────────────────────
alter table public.chart_of_accounts add column if not exists ilpa_category text;
alter table public.chart_of_accounts drop constraint if exists chart_of_accounts_ilpa_category_check;
alter table public.chart_of_accounts add constraint chart_of_accounts_ilpa_category_check check (ilpa_category is null or ilpa_category in (
  'offering_syndication_costs', 'placement_fees',
  'mgmt_fee_gross', 'mgmt_fee_rebate', 'mgmt_fee_waiver', 'mgmt_fee_offset',
  'related_admin', 'related_it', 'related_legal', 'related_organization', 'related_other', 'related_offset',
  'ext_admin', 'ext_valuation', 'ext_it', 'ext_legal', 'ext_investigation', 'ext_audit', 'ext_tax_prep',
  'ext_organization', 'ext_taxes', 'ext_bank_fees', 'ext_sub_facility_fees', 'ext_sub_facility_interest',
  'ext_other_facility_fees', 'ext_other_facility_interest', 'ext_other_interest', 'ext_custody',
  'ext_due_diligence', 'ext_broken_deals', 'ext_travel', 'ext_insurance', 'ext_portfolio_costs', 'ext_other',
  'ext_offset',
  'interest_income', 'dividend_income', 'other_investment_income',
  'net_realized_gain', 'net_unrealized_gain'
));
-- No grant change: chart_of_accounts is granted at the table level (20260702000000), so the new
-- column follows its existing grants and the accounting-domain policies.

-- 2. ─────────────────────────────────────────────────────────────────────────────────────────────
alter table public.portfolio_company_fees drop constraint if exists portfolio_company_fees_kind_check;
alter table public.portfolio_company_fees add constraint portfolio_company_fees_kind_check check (kind in (
  'advisory', 'broken_deal', 'transaction', 'directors', 'monitoring', 'capital_markets',
  'arrangement', 'origination', 'other', 'reimbursement'
));
alter table public.portfolio_company_fees add column if not exists affiliated_amount numeric(18, 2)
  check (affiliated_amount is null or affiliated_amount >= 0);

-- 3. ─────────────────────────────────────────────────────────────────────────────────────────────
create table public.carry_escrow_events (
  id          uuid primary key default gen_random_uuid(),
  fund_id     uuid not null references public.funds(id) on delete cascade,
  vehicle_id  uuid not null references public.fund_vehicles(id) on delete cascade,
  -- deposit = carry paid into the escrow; release = paid out of it to the carry recipients, or
  -- back to the fund on a clawback.
  kind        text not null check (kind in ('deposit', 'release')),
  event_date  date not null,
  amount      numeric(18, 2) not null check (amount > 0),
  memo        text,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

-- Data API access: service role only. Written through the gated gp_economics carry-escrow route and
-- read by the lp_capital ILPA report, never the browser.
revoke all on public.carry_escrow_events from anon, authenticated;
grant select, insert, update, delete on public.carry_escrow_events to service_role;
alter table public.carry_escrow_events enable row level security;

create index carry_escrow_events_vehicle_idx on public.carry_escrow_events (fund_id, vehicle_id, event_date);

-- 4. ─────────────────────────────────────────────────────────────────────────────────────────────
insert into compliance_items (id, category, name, short_name, description, frequency, deadline_description, deadline_month, deadline_day, rolling_days, applicability_text, applicability_question, filing_system, filing_portal_url, regulation_url, form_instructions_url, complexity, notes, alert, sort_order, scope) values
('ilpa-reporting-template', 'Fund Reporting', 'ILPA Reporting Template', 'ILPA Report',
 'Quarterly ILPA Reporting Template (v. 2.0) for each limited partner: the NAV roll-forward with fees, expenses, offsets and carried interest in ILPA''s categories, the commitment reconciliation, and fees the adviser received from portfolio companies.',
 'Quarterly',
 '60 days after the end of Q1 to Q3 (May 30, August 29, November 29); 120 days after year end (April 30)',
 null, null, null,
 'Funds whose limited partners ask for ILPA reporting. ILPA asks GPs to adopt the 2025 template for quarters from Q1 2026; emerging managers agree timing with their LPs.',
 'Do any of your limited partners ask for the ILPA Reporting Template?',
 'Internal', null, 'https://ilpa.org/reporting-template/', null, 'medium',
 'Each partner''s file is on Accounting → Capital accounts → the partner → ILPA report, or the ilpa_reporting_template agent tool, after the quarter is closed. Give expense accounts their ILPA categories first, or their postings report as "Other".',
 null, 29, 'vehicle')
on conflict (id) do update set
  category = excluded.category,
  name = excluded.name,
  short_name = excluded.short_name,
  description = excluded.description,
  frequency = excluded.frequency,
  deadline_description = excluded.deadline_description,
  deadline_month = excluded.deadline_month,
  deadline_day = excluded.deadline_day,
  rolling_days = excluded.rolling_days,
  applicability_text = excluded.applicability_text,
  applicability_question = excluded.applicability_question,
  filing_system = excluded.filing_system,
  filing_portal_url = excluded.filing_portal_url,
  regulation_url = excluded.regulation_url,
  form_instructions_url = excluded.form_instructions_url,
  complexity = excluded.complexity,
  notes = excluded.notes,
  alert = excluded.alert,
  sort_order = excluded.sort_order,
  scope = excluded.scope,
  updated_at = now();
