-- Compliance demo seed data
-- Inserts a compliance profile, dismissed/not-applicable settings, and sample links
-- for any fund that has the compliance_seed items already loaded.
--
-- This runs for ALL funds. If you only want it for a specific fund,
-- wrap the statements in: DO $$ DECLARE target_fund_id uuid := 'YOUR-FUND-ID'; BEGIN ... END $$;

-- For each fund, insert a sample compliance profile
insert into fund_compliance_profile (fund_id, registration_status, aum_range, fund_structure, fundraising_status, reg_d_exemption, investor_state_count, california_nexus, public_equity, cftc_activity, access_person_count, has_foreign_entities, completed_at, updated_at)
select
  fm.fund_id,
  'era',
  '25m_100m',
  'lp',
  'closed_recent',
  '506b',
  '6_to_15',
  '{investments_ca}'::text[],
  'no',
  'yes_with_exemption',
  '1_to_3',
  'no',
  now(),
  now()
from (select distinct fund_id from fund_members) fm
on conflict (fund_id) do nothing;

-- Mark some items as applicable (but not dismissed, so they show on the calendar)
insert into compliance_fund_settings (fund_id, compliance_item_id, portfolio_group, applies, dismissed, updated_at)
select
  fm.fund_id,
  item_id,
  '',
  'yes',
  false,
  now()
from (select distinct fund_id from fund_members) fm
cross join (values ('cftc-exemption'), ('form-adv'), ('tax-7004')) as items(item_id)
on conflict (fund_id, compliance_item_id, portfolio_group) do nothing;

-- Mark some items as not applicable
insert into compliance_fund_settings (fund_id, compliance_item_id, portfolio_group, applies, dismissed, dismissed_at, dismissed_reason, updated_at)
select
  fm.fund_id,
  item_id,
  '',
  'no',
  true,
  now(),
  'Not applicable based on fund profile',
  now()
from (select distinct fund_id from fund_members) fm
cross join (values ('form-13f'), ('sched-13g'), ('form-13h'), ('form-npx'), ('boi-report')) as items(item_id)
on conflict (fund_id, compliance_item_id, portfolio_group) do nothing;

-- Add sample compliance links
insert into compliance_links (fund_id, compliance_item_id, title, description, url)
select
  fm.fund_id,
  'form-adv',
  'IARD Filing Account',
  'FINRA CRD/IARD portal for Form ADV filings',
  'https://crd.finra.org/Iad/'
from (select distinct fund_id from fund_members) fm
where not exists (
  select 1 from compliance_links cl where cl.fund_id = fm.fund_id and cl.compliance_item_id = 'form-adv'
);

insert into compliance_links (fund_id, compliance_item_id, title, description, url)
select
  fm.fund_id,
  'blue-sky',
  'NASAA EFD Portal',
  'Electronic filing depository for state notice filings',
  'https://nasaaefd.org/'
from (select distinct fund_id from fund_members) fm
where not exists (
  select 1 from compliance_links cl where cl.fund_id = fm.fund_id and cl.compliance_item_id = 'blue-sky'
);

insert into compliance_links (fund_id, compliance_item_id, title, description, url)
select
  fm.fund_id,
  'tax-1065',
  'IRS e-File',
  'Partnership return e-filing system',
  'https://www.irs.gov/e-file-providers/e-file-for-large-and-mid-size-corporations'
from (select distinct fund_id from fund_members) fm
where not exists (
  select 1 from compliance_links cl where cl.fund_id = fm.fund_id and cl.compliance_item_id = 'tax-1065'
);
