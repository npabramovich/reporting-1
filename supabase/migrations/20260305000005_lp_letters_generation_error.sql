ALTER TABLE lp_letters ADD COLUMN IF NOT EXISTS generation_error text;
ALTER TABLE lp_letters ADD COLUMN IF NOT EXISTS portfolio_summary jsonb;
ALTER TABLE lp_letters ADD COLUMN IF NOT EXISTS company_prompts jsonb DEFAULT '{}'::jsonb;
