create table investment_transactions (
  id                      uuid        primary key default gen_random_uuid(),
  company_id              uuid        not null references companies(id) on delete cascade,
  fund_id                 uuid        not null references funds(id) on delete cascade,
  transaction_type        text        not null
                                      check (transaction_type in (
                                        'investment', 'proceeds', 'unrealized_gain_change'
                                      )),
  round_name              text,
  transaction_date        date,
  notes                   text,

  -- Investment fields
  investment_cost         numeric,
  interest_converted      numeric     default 0,
  shares_acquired         numeric,
  share_price             numeric,

  -- Proceeds fields
  cost_basis_exited       numeric,
  proceeds_received       numeric,
  proceeds_escrow         numeric     default 0,
  proceeds_written_off    numeric     default 0,
  proceeds_per_share      numeric,

  -- Unrealized gain change fields
  unrealized_value_change numeric,
  current_share_price     numeric,

  created_at              timestamptz default now(),
  updated_at              timestamptz default now()
);

create index idx_investment_txn_company   on investment_transactions (company_id, transaction_date);
create index idx_investment_txn_fund      on investment_transactions (fund_id, transaction_type);

alter table investment_transactions enable row level security;
create policy "Fund members can manage investment transactions"
  on investment_transactions for all
  using (fund_id = any(public.get_my_fund_ids()));
