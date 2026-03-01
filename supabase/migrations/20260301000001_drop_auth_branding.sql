-- Remove auth branding fields from fund_settings
ALTER TABLE fund_settings DROP COLUMN IF EXISTS auth_subtitle;
ALTER TABLE fund_settings DROP COLUMN IF EXISTS auth_contact;
