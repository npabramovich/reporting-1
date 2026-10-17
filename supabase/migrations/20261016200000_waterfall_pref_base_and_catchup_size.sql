-- Two waterfall terms (docs/spec/waterfall-terms.md §2).
--
-- pref_base: what a vehicle's preferred return accrues on (§5).
--
--   'contributed' — every contribution, from the day it was wired, even once it is returned. The
--                   engine's original reading, so it is the default and every existing row keeps
--                   exactly the hurdle it had.
--   'unreturned'  — only capital not yet returned, plus (when it compounds) preferred return
--                   accrued and not yet paid. The more common LPA wording.
--
-- Safe to apply before the release that uses it: a new column with a default changes nothing the
-- current release reads or writes. The release that uses it reads the row with '*', so it still
-- reads terms if it ships first; only SAVING terms needs these columns to exist.

alter table public.vehicle_waterfall_terms
  add column if not exists pref_base text not null default 'contributed'
    check (pref_base in ('contributed', 'unreturned'));

-- catchup_size: how much of a full catch-up the GP gets, 0 to 1 (§3.2). A full catch-up is the carry
-- the GP would have earned on the profit that paid the preferred return. 1, the default, is a full
-- catch-up, which is what every existing row already gets. The catch-up RATE (catchup_rate, the
-- GP's share of each dollar while it catches up) is unchanged.

alter table public.vehicle_waterfall_terms
  add column if not exists catchup_size numeric not null default 1
    check (catchup_size >= 0 and catchup_size <= 1);

comment on column public.vehicle_waterfall_terms.catchup_size is
  'How much of a full catch-up the GP gets, 0 to 1 (1 = full). A full catch-up leaves the GP holding the carry rate of the preferred return plus the catch-up.';

comment on column public.vehicle_waterfall_terms.pref_base is
  'What the preferred return accrues on: contributed (all contributions, even once returned) or unreturned (capital not yet returned, plus unpaid pref when it compounds).';
