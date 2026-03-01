-- Unify notes: make company_id optional so notes can be fund-level
ALTER TABLE company_notes ALTER COLUMN company_id DROP NOT NULL;

-- Drop the separate fund_notes table (replaced by company_notes with company_id = NULL)
DROP TABLE IF EXISTS fund_notes;
