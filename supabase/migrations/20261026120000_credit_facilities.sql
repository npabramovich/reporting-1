-- Credit facilities: a vehicle's subscription line (or other borrowing) and what moved on it.
--
-- A fund draws on a subscription line to invest or pay expenses ahead of a capital call, then
-- repays it from the call. The ledger already has the accounts (2200 Loan payable, 5300 Interest
-- expense), but nothing said which borrowing a posting belonged to, what a draw paid for, or when it
-- was repaid. Those are what the ILPA Performance Template needs to state returns with and without
-- the line, so they get a register (lib/accounting/credit-facility.ts is the one write path):
--
--   credit_facilities        one row per facility: its kind, lender, size, dates and rate.
--   credit_facility_events   one row per draw, repayment, interest payment or fee. Each either
--                            posts its own entry (draw: Dr cash / Cr loan; repayment: the reverse;
--                            interest or fee: Dr interest expense / Cr cash, allocated to the
--                            partners) or links an entry already on the books, so a line booked
--                            from the bank feed is registered without booking it twice.
--
-- ADDITIVE AND SAFE BEFORE DEPLOY. Two new tables nothing reads until this release ships.

create table public.credit_facilities (
  id               uuid primary key default gen_random_uuid(),
  fund_id          uuid not null references funds(id) on delete cascade,
  vehicle_id       uuid not null references fund_vehicles(id) on delete cascade,
  name             text not null check (length(trim(name)) > 0),
  -- subscription = secured by the partners' uncalled commitments (what ILPA calls a fund-level
  -- subscription facility). nav = secured by the portfolio. other = anything else.
  kind             text not null default 'subscription' check (kind in ('subscription', 'nav', 'other')),
  lender           text,
  commitment_amount numeric check (commitment_amount is null or commitment_amount > 0),
  opened_on        date,
  matures_on       date,
  rate_description text,
  notes            text,
  created_by       uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (fund_id, vehicle_id, name)
);

create table public.credit_facility_events (
  id               uuid primary key default gen_random_uuid(),
  fund_id          uuid not null references funds(id) on delete cascade,
  vehicle_id       uuid not null references fund_vehicles(id) on delete cascade,
  facility_id      uuid not null references credit_facilities(id) on delete cascade,
  event_type       text not null check (event_type in ('draw', 'repayment', 'interest', 'fee')),
  event_date       date not null,
  amount           numeric not null check (amount > 0),
  -- What a draw paid for. Repayments take theirs from the draws they repay, oldest first.
  purpose          text check (purpose in ('investment', 'management_fee', 'fund_expense', 'working_capital')),
  -- The capital call whose proceeds paid this repayment, interest or fee, when known.
  call_id          uuid references capital_calls(id) on delete set null,
  journal_entry_id uuid references journal_entries(id) on delete set null,
  -- posted = this register wrote the entry; linked = the entry was already on the books.
  entry_origin     text not null default 'posted' check (entry_origin in ('posted', 'linked')),
  memo             text,
  created_by       uuid,
  created_at       timestamptz not null default now(),
  check (event_type <> 'draw' or purpose is not null),
  check (event_type = 'draw' or purpose is null)
);

create index credit_facilities_vehicle_idx on public.credit_facilities (fund_id, vehicle_id);
create index credit_facility_events_facility_idx on public.credit_facility_events (fund_id, vehicle_id, facility_id, event_date);
-- One register row per entry, so a linked entry cannot be counted twice.
create unique index credit_facility_events_entry_uidx on public.credit_facility_events (journal_entry_id) where journal_entry_id is not null;

-- Data API access: service role only. Every read and write goes through the gated lp_capital
-- routes and agent tools, never the browser.
revoke all on public.credit_facilities from anon, authenticated;
grant select, insert, update, delete on public.credit_facilities to service_role;
alter table public.credit_facilities enable row level security;

revoke all on public.credit_facility_events from anon, authenticated;
grant select, insert, update, delete on public.credit_facility_events to service_role;
alter table public.credit_facility_events enable row level security;
