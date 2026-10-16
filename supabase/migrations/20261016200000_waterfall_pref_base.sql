-- What a vehicle's preferred return accrues on (docs/spec/waterfall-terms.md §5).
--
--   'contributed' — every contribution, from the day it was wired, even once it is returned. The
--                   engine's original reading, so it is the default and every existing row keeps
--                   exactly the hurdle it had.
--   'unreturned'  — only capital not yet returned, plus (when it compounds) preferred return
--                   accrued and not yet paid. The more common LPA wording.
--
-- Safe to apply before the release that uses it: a new column with a default changes nothing the
-- current release reads or writes. The release that uses it reads the row with '*', so it still
-- reads terms if it ships first; only SAVING terms needs this column to exist.

alter table public.vehicle_waterfall_terms
  add column if not exists pref_base text not null default 'contributed'
    check (pref_base in ('contributed', 'unreturned'));

comment on column public.vehicle_waterfall_terms.pref_base is
  'What the preferred return accrues on: contributed (all contributions, even once returned) or unreturned (capital not yet returned, plus unpaid pref when it compounds).';
