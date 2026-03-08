DROP TABLE IF EXISTS portfolio_group_metrics;

CREATE TABLE fund_cash_flows (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  fund_id         uuid        NOT NULL REFERENCES funds(id) ON DELETE CASCADE,
  portfolio_group text        NOT NULL,
  flow_date       date        NOT NULL,
  flow_type       text        NOT NULL CHECK (flow_type IN ('commitment', 'called_capital', 'distribution')),
  amount          numeric     NOT NULL CHECK (amount > 0),
  notes           text,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

ALTER TABLE fund_cash_flows ENABLE ROW LEVEL SECURITY;
