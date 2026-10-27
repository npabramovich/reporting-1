-- One more waterfall term on vehicle_waterfall_terms (docs/spec/waterfall-terms.md,
-- packages/fund-engine/src/distribution-waterfall.ts):
--
--   gp_commit_bears_carry  the carry recipients' own commitments (the GP commit) bear carry like
--                          an LP's: a distribution runs their capital through the tiers instead of
--                          giving it a carry-free share beside them. False is what every vehicle
--                          meant before this existed.
--
-- ADDITIVE, AND IT MUST BE APPLIED BEFORE THE RELEASE THAT WRITES IT. The live release reads the
-- row with select * and doesn't know the column; the release that saves the terms writes it on
-- every save, so saving fails until the column exists.

alter table public.vehicle_waterfall_terms
  add column if not exists gp_commit_bears_carry boolean not null default false;
