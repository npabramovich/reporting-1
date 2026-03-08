CREATE TABLE IF NOT EXISTS fund_group_config (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  fund_id         uuid        NOT NULL REFERENCES funds(id) ON DELETE CASCADE,
  portfolio_group text        NOT NULL,
  cash_on_hand    numeric     NOT NULL DEFAULT 0,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  UNIQUE (fund_id, portfolio_group)
);

ALTER TABLE fund_group_config ENABLE ROW LEVEL SECURITY;
