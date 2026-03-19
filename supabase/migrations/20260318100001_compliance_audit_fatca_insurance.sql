-- Add has_foreign_investors to compliance profile for FATCA/CRS applicability
ALTER TABLE fund_compliance_profile ADD COLUMN IF NOT EXISTS has_foreign_investors text; -- yes, no, unsure
