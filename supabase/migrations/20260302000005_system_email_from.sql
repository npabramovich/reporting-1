ALTER TABLE fund_settings
  ADD COLUMN IF NOT EXISTS system_email_from_name text,
  ADD COLUMN IF NOT EXISTS system_email_from_address text;
