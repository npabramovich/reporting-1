-- A holding — and its commitment — belongs to the ENTITY that made it.
--
-- `fund_holding_terms.company_id` was UNIQUE, which asserted one commitment per underlying fund
-- across the whole firm. That is the same wrong assumption the NAV constraint carried
-- (20261006210000): two of our entities investing in the same fund have two different commitments,
-- two different called amounts and two different unfunded balances, and the schedule of
-- investments now shows exactly those figures — so a shared row would read wrong for both.
--
-- It also means the holding's entity is recorded ONCE, here, rather than only being inferable from
-- whatever activity happens to exist. A fund committed to but not yet called has no capital events
-- at all, and until now nothing tied it to an entity.
--
-- NULLS NOT DISTINCT, as on the NAV constraint: terms rows created before this (and any created
-- without an entity) keep exactly their old rule of one per fund.
--
-- DEPLOY WITH THE MATCHING CODE. The terms upsert names its conflict target, and a release still
-- asking for `company_id` alone fails against this schema.

alter table public.fund_holding_terms
  add column if not exists vehicle_id uuid references public.fund_vehicles(id) on delete cascade;

-- BACKFILL from the register AND the ledger, and only where it is unambiguous: a holding whose
-- capital events, NAV statements and per-company investment accounts all name one entity belongs
-- to that entity. A holding with activity under two
-- entities, or none at all, is left null for someone to state — guessing it from a single matching
-- name is exactly the invented identity the evidence rules refuse.
with resolved as (
  -- No min(uuid) in PostgreSQL; the HAVING below means there is exactly one to take.
  select company_id, (array_agg(distinct vehicle_id))[1] as vehicle_id
    from (
      select company_id, vehicle_id from public.fund_capital_events where vehicle_id is not null
      union
      select company_id, vehicle_id from public.fund_nav_statements where vehicle_id is not null
      union
      -- AND THE LEDGER. A holding imported from a general ledger carries its own
      -- 1100-<id>/1200-<id> accounts on one vehicle long before anyone records a notice, so this
      -- is what resolves a register that is still being filled in.
      select company_id, vehicle_id from public.chart_of_accounts
       where company_id is not null and vehicle_id is not null
    ) activity
   group by company_id
  having count(distinct vehicle_id) = 1
)
update public.fund_holding_terms t
   set vehicle_id = r.vehicle_id
  from resolved r
 where r.company_id = t.company_id
   and t.vehicle_id is null;

alter table public.fund_holding_terms
  drop constraint if exists fund_holding_terms_company_id_key;

-- Belt and braces: drop any unique constraint on company_id alone rather than trusting the name
-- PostgreSQL generated for the inline UNIQUE in 20260806000000.
do $$
declare
  name text;
begin
  for name in
    select c.conname
      from pg_constraint c
     where c.conrelid = 'public.fund_holding_terms'::regclass
       and c.contype = 'u'
       and (
         select array_agg(a.attname::text order by a.attname)
           from unnest(c.conkey) k join pg_attribute a
             on a.attrelid = c.conrelid and a.attnum = k
       ) = array['company_id']
  loop
    execute format('alter table public.fund_holding_terms drop constraint %I', name);
  end loop;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.fund_holding_terms'::regclass
       and conname = 'fund_holding_terms_holding_vehicle_key'
  ) then
    alter table public.fund_holding_terms
      add constraint fund_holding_terms_holding_vehicle_key
      unique nulls not distinct (company_id, vehicle_id);
  end if;
end $$;

create index if not exists fund_holding_terms_vehicle_idx
  on public.fund_holding_terms (fund_id, vehicle_id);

comment on column public.fund_holding_terms.vehicle_id is
  'Which of our entities holds this fund. The commitment, and everything derived from it '
  '(unfunded, % called), is that entity''s — not the firm''s. Null only where the register could '
  'not resolve it unambiguously.';
