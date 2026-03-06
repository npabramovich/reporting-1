-- Add 'round_info' to the investment_transactions transaction_type check constraint
alter table investment_transactions
  drop constraint if exists investment_transactions_transaction_type_check;

alter table investment_transactions
  add constraint investment_transactions_transaction_type_check
  check (transaction_type in (
    'investment', 'proceeds', 'unrealized_gain_change', 'round_info'
  ));
