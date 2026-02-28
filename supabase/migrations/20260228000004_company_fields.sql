-- Rename sector → industry
ALTER TABLE companies RENAME COLUMN sector TO industry;

-- Add new company fields
ALTER TABLE companies ADD COLUMN IF NOT EXISTS overview text;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS founders text;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS why_invested text;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS current_update text;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS contact_email text;
