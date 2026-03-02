ALTER TABLE fund_settings
  ADD COLUMN IF NOT EXISTS approval_email_subject text,
  ADD COLUMN IF NOT EXISTS approval_email_body text;
