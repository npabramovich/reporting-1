-- Bank transaction staging — the single landing zone for raw transactions from
-- ANY source (CSV/Excel today; Plaid, Ramp, QuickBooks later). Rows are ingested
-- here, then a categorization step drafts a balanced journal entry for each and
-- links it back. This staging layer is also the bank-reconciliation substrate:
-- ledger cash vs. the bank feed, matched row by row.
--
-- amount is signed: positive = money in (deposit), negative = money out.

create table public.bank_transactions (
  id                    uuid primary key default gen_random_uuid(),
  fund_id               uuid not null references funds(id) on delete cascade,
  source                text not null default 'csv',   -- csv | plaid | ramp | quickbooks | manual
  external_id           text,                            -- provider id, for connector dedup
  dedup_hash            text not null,                   -- stable hash for import idempotency
  txn_date              date not null,
  amount                numeric(20, 2) not null,
  currency              text not null default 'USD',
  description           text,
  counterparty          text,
  status                text not null default 'unmatched'
                          check (status in ('unmatched', 'drafted', 'reconciled', 'ignored')),
  journal_entry_id      uuid references journal_entries(id) on delete set null,
  suggested_account_code text,
  raw                   jsonb,
  imported_by           uuid,
  created_at            timestamptz not null default now(),
  unique (fund_id, dedup_hash)
);

-- Grants — anon SELECT only (no unauthenticated writes); authenticated +
-- service_role full CRUD, RLS scopes rows. Mirrors the members-read/admins-write
-- posture of the ledger.
grant select on public.bank_transactions to anon;
grant select, insert, update, delete on public.bank_transactions to authenticated, service_role;

alter table public.bank_transactions enable row level security;

create policy "Fund members read their fund's bank transactions"
  on public.bank_transactions for select to authenticated
  using (exists (
    select 1 from fund_members fm
    where fm.fund_id = bank_transactions.fund_id and fm.user_id = auth.uid()
  ));

create policy "Fund admins write their fund's bank transactions"
  on public.bank_transactions for all to authenticated
  using (exists (
    select 1 from fund_members fm
    where fm.fund_id = bank_transactions.fund_id and fm.user_id = auth.uid() and fm.role = 'admin'
  ))
  with check (exists (
    select 1 from fund_members fm
    where fm.fund_id = bank_transactions.fund_id and fm.user_id = auth.uid() and fm.role = 'admin'
  ));

create index bank_transactions_fund_idx on public.bank_transactions (fund_id, txn_date desc);
create index bank_transactions_status_idx on public.bank_transactions (fund_id, status);
