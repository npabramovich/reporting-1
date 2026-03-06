ALTER TABLE fund_settings
ADD COLUMN IF NOT EXISTS feature_visibility jsonb
DEFAULT '{"interactions":"everyone","investments":"everyone","notes":"everyone","lp_letters":"everyone","imports":"everyone","asks":"everyone"}'::jsonb;
