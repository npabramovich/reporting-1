-- ASC 946 Schedule of Investments needs three breakouts: industry, GEOGRAPHY, and
-- SECURITY TYPE. Industry already exists (companies.industry text[]). The other two
-- were not modelable at all — nothing in the schema recorded where a company is
-- domiciled, or what instrument the fund actually holds.
--
-- No grants block: these are ALTER TABLE ADD COLUMN on existing tables, and table
-- grants already cover new columns. RLS on both tables is unchanged.

-- 1. Geography ---------------------------------------------------------------
-- Country of domicile/incorporation — the SOI groups fair value by it. ISO 3166-1
-- alpha-2 (e.g. 'US', 'GB', 'IL'); free text kept so it can be typed loosely and
-- normalized later. Single-valued on purpose: a company sits in exactly one SOI
-- geography band, unlike `industry`, whose text[] already forces a primary-industry
-- convention on the reporting side.
alter table public.companies
  add column if not exists country text;

comment on column public.companies.country is
  'Country of domicile for the ASC 946 Schedule of Investments geography breakout. ISO 3166-1 alpha-2 preferred.';

-- 2. Security type -----------------------------------------------------------
-- What the fund holds in this transaction. Today the SOI infers a two-bucket proxy
-- ("priced equity" if shares > 0 and price > 0, else "convertible/SAFE"), which
-- cannot distinguish Preferred from Common and cannot see a warrant at all.
-- Recorded per transaction, not per company: a fund can hold a SAFE and then
-- preferred stock in the same company.
alter table public.investment_transactions
  add column if not exists security_type text;

alter table public.investment_transactions
  drop constraint if exists investment_transactions_security_type_check;

alter table public.investment_transactions
  add constraint investment_transactions_security_type_check
  check (security_type is null or security_type in (
    'preferred',
    'common',
    'safe',
    'convertible_note',
    'warrant',
    'option',
    'llc_units',
    'other'
  ));

comment on column public.investment_transactions.security_type is
  'Instrument held, for the ASC 946 Schedule of Investments asset-type breakout. Null = fall back to the derived priced-equity/convertible proxy.';

-- 3. Backfill what is unambiguous -------------------------------------------
-- round_name is free text but has been used consistently enough to infer the common
-- cases. Anything that does not clearly match is left NULL rather than guessed, so
-- the SOI falls back to the derived proxy instead of asserting something false.
update public.investment_transactions
   set security_type = 'preferred'
 where security_type is null
   and round_name ilike '%preferred%';

update public.investment_transactions
   set security_type = 'safe'
 where security_type is null
   and (round_name ilike '%safe%' or round_name ilike '%s.a.f.e%');

update public.investment_transactions
   set security_type = 'convertible_note'
 where security_type is null
   and (round_name ilike '%convertible%' or round_name ilike '%conv. note%' or round_name ilike '%note%')
   and round_name not ilike '%notes receivable%';

update public.investment_transactions
   set security_type = 'warrant'
 where security_type is null
   and round_name ilike '%warrant%';

update public.investment_transactions
   set security_type = 'common'
 where security_type is null
   and round_name ilike '%common%';

create index if not exists investment_transactions_security_type_idx
  on public.investment_transactions (security_type)
  where security_type is not null;

create index if not exists companies_country_idx
  on public.companies (country)
  where country is not null;
