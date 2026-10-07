-- A manager NAV belongs to the ENTITY that holds the fund, not to the firm.
--
-- `fund_nav_statements` was unique on (company_id, as_of_date), which silently asserted that each
-- underlying fund is held by exactly one of our entities: two entities both invested in the same
-- fund could not each record their own 30 September statement, because the second insert collided
-- with the first. Their positions are independent — different commitments, different capital
-- accounts, different NAVs — so there is no reason for the statement to be shared.
--
-- NULLS NOT DISTINCT (PostgreSQL 15+) is what keeps this safe on existing data. `vehicle_id` is
-- nullable and some historical rows have no entity recorded, and a plain unique index treats every
-- NULL as different — so without it two null-entity rows for one fund and date would both be
-- accepted, which is looser than what we have today. With it, those rows keep exactly their old
-- constraint (one per fund per date) while rows that DO name an entity get one each.
--
-- DEPLOY THIS WITH THE MATCHING CODE, not before it: both upsert sites name the conflict target
-- (`onConflict: 'company_id,vehicle_id,as_of_date'`), and a release still asking for
-- `company_id,as_of_date` fails against this schema with "no unique or exclusion constraint
-- matching the ON CONFLICT specification".

alter table public.fund_nav_statements
  drop constraint if exists fund_nav_statements_company_id_as_of_date_key;

-- Belt and braces: the constraint above is the name PostgreSQL generates for the inline
-- `unique (company_id, as_of_date)` in 20260806000000, but drop any other unique constraint on
-- exactly that column pair rather than trusting the generated name.
do $$
declare
  conname text;
begin
  for conname in
    select c.conname
      from pg_constraint c
     where c.conrelid = 'public.fund_nav_statements'::regclass
       and c.contype = 'u'
       and (
         select array_agg(a.attname::text order by a.attname)
           from unnest(c.conkey) k join pg_attribute a
             on a.attrelid = c.conrelid and a.attnum = k
       ) = array['as_of_date', 'company_id']
  loop
    execute format('alter table public.fund_nav_statements drop constraint %I', conname);
  end loop;
end $$;

-- Guarded: PostgreSQL has no ADD CONSTRAINT IF NOT EXISTS, and a migration that cannot be run
-- twice is a migration that fails the moment anyone re-applies it.
do $$ begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.fund_nav_statements'::regclass
       and conname = 'fund_nav_statements_holding_vehicle_date_key'
  ) then
    alter table public.fund_nav_statements
      add constraint fund_nav_statements_holding_vehicle_date_key
      unique nulls not distinct (company_id, vehicle_id, as_of_date);
  end if;
end $$;

comment on constraint fund_nav_statements_holding_vehicle_date_key on public.fund_nav_statements is
  'One manager statement per underlying fund, per holding entity, per as-of date. Two of our '
  'entities invested in the same fund each record their own. NULLS NOT DISTINCT so rows with no '
  'entity recorded keep the original one-per-fund-per-date rule.';
