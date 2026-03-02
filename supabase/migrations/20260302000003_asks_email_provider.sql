ALTER TABLE fund_settings
  ADD COLUMN IF NOT EXISTS asks_email_provider text;

-- Backfill: existing funds get same provider for asks as their current outbound
UPDATE fund_settings
SET asks_email_provider = outbound_email_provider
WHERE outbound_email_provider IS NOT NULL AND asks_email_provider IS NULL;
