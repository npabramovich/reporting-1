-- Add vehicle-level (portfolio_group) scoping to compliance tables.
-- Some compliance items are firm-level (Form ADV, compliance review, privacy notice)
-- while others are per-fund-vehicle (Form D, Blue Sky, K-1s, financial reporting, valuations).

-- 1. Add scope column to compliance_items (reference data)
ALTER TABLE compliance_items ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'firm';
-- scope: 'firm' = one per fund, 'vehicle' = one per portfolio_group within fund

-- 2. Add portfolio_group to fund-scoped compliance tables
--    Firm-level items use '' (empty string). Vehicle-level items use the portfolio group name.
ALTER TABLE compliance_fund_settings ADD COLUMN IF NOT EXISTS portfolio_group text NOT NULL DEFAULT '';
ALTER TABLE compliance_deadlines ADD COLUMN IF NOT EXISTS portfolio_group text NOT NULL DEFAULT '';
ALTER TABLE compliance_filings ADD COLUMN IF NOT EXISTS portfolio_group text NOT NULL DEFAULT '';

-- 3. Update unique constraints to include portfolio_group
ALTER TABLE compliance_fund_settings DROP CONSTRAINT IF EXISTS compliance_fund_settings_fund_id_compliance_item_id_key;
ALTER TABLE compliance_fund_settings
  ADD CONSTRAINT compliance_fund_settings_fund_item_group_uniq
  UNIQUE (fund_id, compliance_item_id, portfolio_group);

ALTER TABLE compliance_deadlines DROP CONSTRAINT IF EXISTS compliance_deadlines_fund_id_compliance_item_id_year_key;
ALTER TABLE compliance_deadlines
  ADD CONSTRAINT compliance_deadlines_fund_item_year_group_uniq
  UNIQUE (fund_id, compliance_item_id, year, portfolio_group);

-- 4. Mark vehicle-scoped items in seed data
UPDATE compliance_items SET scope = 'vehicle' WHERE id IN (
  'form-d',
  'blue-sky',
  'tax-1065',
  'tax-7004',
  'schedule-k1',
  'quarterly-financial-reporting',
  'valuations-soi'
);
