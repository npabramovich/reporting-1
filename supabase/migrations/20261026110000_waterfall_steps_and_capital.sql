-- Two more waterfall terms on vehicle_waterfall_terms (docs/spec/waterfall-terms.md,
-- packages/fund-engine/src/waterfall.ts and hurdle.ts):
--
--   carry_steps       where the carry steps up, in order: [{ lpMultiple | lpIrr, carryRate,
--                     catchUpRate? }]. The split before each step runs until the LPs have that
--                     multiple of their capital, or that IRR, and the next one runs at the new rate.
--                     Null: one carry rate.
--   capital_includes  the contribution purposes returned as capital and accrued on, any of
--                     'investments', 'fees', 'expenses', 'other'. Null: all of them. An LPA that
--                     returns only invested capital before carry stores {investments}.
--
-- ADDITIVE AND SAFE BEFORE DEPLOY. Nullable columns that the live release neither reads nor writes
-- (it reads the row with select * and upserts its own columns by name). Null is what every vehicle
-- meant before these existed. Push it before the release that writes them goes out.

alter table public.vehicle_waterfall_terms
  add column if not exists carry_steps jsonb
    check (carry_steps is null or jsonb_typeof(carry_steps) = 'array'),
  add column if not exists capital_includes text[]
    check (capital_includes is null or (
      capital_includes <@ array['investments', 'fees', 'expenses', 'other']::text[]
      and 'investments' = any(capital_includes)
    ));
