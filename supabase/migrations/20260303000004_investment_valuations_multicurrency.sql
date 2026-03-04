-- Add valuation fields (in fund currency)
ALTER TABLE investment_transactions
  ADD COLUMN postmoney_valuation          NUMERIC,
  ADD COLUMN latest_postmoney_valuation   NUMERIC,
  ADD COLUMN exit_valuation               NUMERIC;

-- Multi-currency support (null means deal is in fund currency)
ALTER TABLE investment_transactions
  ADD COLUMN original_currency                    TEXT,
  ADD COLUMN original_investment_cost              NUMERIC,
  ADD COLUMN original_share_price                  NUMERIC,
  ADD COLUMN original_postmoney_valuation          NUMERIC,
  ADD COLUMN original_proceeds_received            NUMERIC,
  ADD COLUMN original_proceeds_per_share           NUMERIC,
  ADD COLUMN original_exit_valuation               NUMERIC,
  ADD COLUMN original_unrealized_value_change      NUMERIC,
  ADD COLUMN original_current_share_price          NUMERIC,
  ADD COLUMN original_latest_postmoney_valuation   NUMERIC;
