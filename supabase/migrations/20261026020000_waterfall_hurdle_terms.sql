-- Three more hurdle terms on vehicle_waterfall_terms, so the books can hold what an LPA says
-- (docs/spec/waterfall-terms.md, packages/fund-engine/src/hurdle.ts and waterfall.ts):
--
--   pref_multiple    a hurdle set as a multiple of capital instead of a rate: the LPs get this
--                    multiple of their capital back before the catch-up. Null = the rate.
--   pref_day_count   how the rate's years are counted: 'act/365' (the default) or '30/360'.
--   catchup_measure  what the catch-up is measured on: 'preferred' (the GP gets carry / (1 − carry)
--                    of the pref paid, the default) or 'profit' (the GP catches up to its share of
--                    all the profit distributed). They differ only when the LPs share the catch-up.
--
-- ADDITIVE AND SAFE BEFORE DEPLOY. Nullable or defaulted columns that the live release neither reads
-- nor writes (it reads the row with select * and upserts its own columns by name). The defaults are
-- what every vehicle meant before these existed.

alter table public.vehicle_waterfall_terms
  add column if not exists pref_multiple numeric
    check (pref_multiple is null or (pref_multiple >= 1 and pref_multiple <= 10)),
  add column if not exists pref_day_count text not null default 'act/365'
    check (pref_day_count in ('act/365', '30/360')),
  add column if not exists catchup_measure text not null default 'preferred'
    check (catchup_measure in ('preferred', 'profit'));
