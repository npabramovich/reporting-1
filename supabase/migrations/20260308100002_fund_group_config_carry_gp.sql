ALTER TABLE fund_group_config
  ADD COLUMN IF NOT EXISTS carry_rate numeric NOT NULL DEFAULT 0.20,
  ADD COLUMN IF NOT EXISTS gp_commit_pct numeric NOT NULL DEFAULT 0;
