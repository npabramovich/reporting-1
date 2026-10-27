-- Rename chart_of_accounts.ilpa_category to reporting_category, so no schema name carries a
-- standard-setter's name. Same values, same meaning: the Reporting Template line an income or
-- expense account's postings land on (lib/lp-templates/reporting-types.ts ACCOUNT_CATEGORIES); null
-- follows the account's subtype.
--
-- SAFE TO RE-RUN, and safe whether or not 20261026160000_lp_reporting_template.sql has been applied
-- yet: it renames the old column when that exists, and adds the new one otherwise.
--
-- APPLY WITH THE RELEASE THAT READS reporting_category. The release before it reads ilpa_category,
-- so between this and that deploy the quarterly report download fails with an error and the chart's
-- category picker shows every account "by type". Nothing is lost: the values move with the column.

do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'chart_of_accounts' and column_name = 'ilpa_category')
     and not exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'chart_of_accounts' and column_name = 'reporting_category') then
    alter table public.chart_of_accounts rename column ilpa_category to reporting_category;
  end if;
end
$$;

alter table public.chart_of_accounts add column if not exists reporting_category text;

alter table public.chart_of_accounts drop constraint if exists chart_of_accounts_ilpa_category_check;
alter table public.chart_of_accounts drop constraint if exists chart_of_accounts_reporting_category_check;
alter table public.chart_of_accounts add constraint chart_of_accounts_reporting_category_check check (reporting_category is null or reporting_category in (
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
-- No grant change: chart_of_accounts is granted at the table level (20260702000000), so the
-- column keeps following its existing grants and the accounting-domain policies.
