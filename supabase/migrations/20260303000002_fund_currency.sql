-- Add fund-level currency setting (ISO 4217 code)
ALTER TABLE fund_settings
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'USD';
