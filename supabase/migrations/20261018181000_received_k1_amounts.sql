-- What a lower-tier K-1 actually SAYS, not only that it arrived.
--
-- received_k1s (20260827000006) records whether each fund holding has delivered its Schedule K-1
-- for a year, plus three loose tie-out figures. The amounts themselves stayed on paper, so a
-- preparer booked each holding's pass-through by hand in the tax book at year end — ordinary
-- income, interest, dividends, capital gain by term, §1231, deductions — and the fund's OWN K-1s
-- could not see the character at all.
--
-- These columns hold the Part III boxes an investing fund actually receives, plus Item L as the
-- underlying fund reported it. lib/accounting/k1-passthrough-run.ts derives tax-book entries from
-- them (source_ref `tax-k1:<year>:<holding>`), which is what carries the character through to the
-- fund's own partners.
--
-- ADDITIVE AND SAFE BEFORE DEPLOY. Nullable columns on an existing table; the release that is live
-- now upserts the columns it knows by name and never touches these, so nothing it writes clears
-- them. No new table, so no new grants: received_k1s stays service-role only (20260903160000),
-- and tests/tax-data-api-grants.test.ts already pins it.
--
-- Signs as printed on the form: income and gain boxes signed (a loss is negative); deductions
-- (boxes 12 and 13) and distributions (box 19) as positive amounts; Item L withdrawals positive.
-- Every amount is in the fund's reporting currency, like the rest of the ledger.

alter table public.received_k1s
  -- Part III
  add column if not exists box1_ordinary_business      numeric,
  add column if not exists box2_net_rental_real_estate numeric,
  add column if not exists box3_other_net_rental       numeric,
  add column if not exists box4_guaranteed_payments    numeric,
  add column if not exists box5_interest               numeric,
  add column if not exists box6a_ordinary_dividends    numeric,
  -- A SUBSET of 6a, never an addition to it.
  add column if not exists box6b_qualified_dividends   numeric,
  add column if not exists box7_royalties              numeric,
  add column if not exists box8_net_short_term_gain    numeric,
  add column if not exists box9a_net_long_term_gain    numeric,
  add column if not exists box10_net_1231_gain         numeric,
  add column if not exists box11_other_income          numeric,
  add column if not exists box12_section_179           numeric,
  -- Box 13 is one box with many codes. Investment interest (code H) is kept apart because the
  -- fund's own partners report it on a different form (4952) from the rest.
  add column if not exists box13_investment_interest   numeric,
  add column if not exists box13_other_deductions      numeric,
  add column if not exists box19a_distributions_cash   numeric,
  add column if not exists box19c_distributions_property numeric,
  -- Part II, Item L, as reported. Informational: the run compares it with the tax basis it derives.
  add column if not exists capital_beginning           numeric,
  add column if not exists capital_contributed         numeric,
  add column if not exists capital_current_year_income numeric,
  add column if not exists capital_other_increase      numeric,
  add column if not exists capital_withdrawals         numeric,
  add column if not exists capital_ending              numeric,
  -- When the amounts were last entered. Null means only the status is known, and the run skips
  -- the holding rather than reading every empty box as a reported zero.
  add column if not exists amounts_recorded_at         timestamptz,
  add column if not exists amounts_recorded_by         uuid;

comment on column public.received_k1s.amounts_recorded_at is
  'Set when the Schedule K-1 amounts were entered. The tax-book pass-through run reads only rows '
  'with amounts recorded, so an empty box is never taken for a reported zero.';
