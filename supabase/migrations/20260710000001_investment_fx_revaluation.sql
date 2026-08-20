-- FX revaluation inputs for `unrealized_gain_change` transactions.
--
-- Rate convention: fx_rate is fund-currency units per one unit of the deal's
-- original currency, so fund_amount = original_amount * fx_rate. A EUR deal
-- held by a USD-reporting fund at "1 EUR = 1.10 USD" stores fx_rate = 1.10.
--
-- No grants block here: this alters an existing table already covered by
-- 20260513000000_data_api_grants_backfill.sql, and leaves RLS/policies as-is.

alter table investment_transactions
  add column valuation_change_source text,
  add column fx_rate                 numeric,
  add column prior_fx_rate           numeric,
  add column fx_value_change         numeric,
  add column original_position_value numeric;

alter table investment_transactions
  add constraint investment_transactions_valuation_change_source_check
  check (valuation_change_source is null or valuation_change_source in ('mark', 'fx'));

alter table investment_transactions
  add constraint investment_transactions_fx_rate_positive
  check (fx_rate is null or fx_rate > 0);

alter table investment_transactions
  add constraint investment_transactions_prior_fx_rate_positive
  check (prior_fx_rate is null or prior_fx_rate > 0);

comment on column investment_transactions.valuation_change_source is
  'For unrealized_gain_change rows: ''mark'' (new valuation) or ''fx'' (rate move only). Null on legacy rows, treated as ''mark''.';

comment on column investment_transactions.fx_rate is
  'Fund-currency units per 1 unit of original_currency at this transaction.';

comment on column investment_transactions.prior_fx_rate is
  'The fx_rate the position was carried at immediately before this revaluation.';

comment on column investment_transactions.fx_value_change is
  'Fund-currency value change attributable to the rate move. On an fx-source row this equals unrealized_value_change.';

comment on column investment_transactions.original_position_value is
  'Position value in original_currency that the rate move was applied to. Held constant across an fx revaluation.';
