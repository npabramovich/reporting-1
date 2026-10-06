-- Read-only. Paste into the Supabase SQL editor for the project you applied the migrations to.
--
-- WHY: 20261006174711 drops vehicle_accounting_settings.capital_source and history_mode. The
-- committed code still reads them (lib/accounting/capital-source.ts, fund-preload.ts,
-- lp-positions.ts, terms.ts) and every one of those reads destructures only `{ data }` and
-- ignores `error` — so against the new schema they do not fail, they return the DEFAULT. Every
-- vehicle that actually keeps books gets reported as a statement-only vehicle instead.
--
-- This query says whether that applies to this database, and how many vehicles it would affect.
-- It writes nothing.

with cols as (
  select count(*)::int n from information_schema.columns
  where table_schema = 'public' and table_name = 'vehicle_accounting_settings'
    and column_name in ('capital_source', 'history_mode')
),
scale as (
  select (select count(*) from public.fund_members)::int members,
         (select count(*) from public.funds)::int funds
),
books as (
  -- The vehicles the old code would now misreport: the ones with real posted books.
  select count(distinct vehicle_id)::int n from public.journal_entries
  where book = 'actual' and status = 'posted'
)
select
  (select n from cols)        as mode_columns_remaining,   -- 2 = not dropped here, 0 = dropped
  (select funds from scale)   as funds,
  (select members from scale) as fund_members,
  (select n from books)       as vehicles_with_posted_books,
  case
    when (select n from cols) > 0
      then 'OK - the mode columns are still present, so the retirement migration did not run against this database.'
    when (select members from scale) = 0
      then 'OK - columns are dropped, but this database has no fund members, so it is a scratch or dev database.'
    when (select n from books) = 0
      then 'OK - columns are dropped, but no vehicle keeps posted books, so the old code''s "statement-only" default was already the right answer.'
    else 'ACT - columns are dropped and ' || (select n from books)::text ||
         ' vehicle(s) keep posted books. A deployed build of the committed code reports those as statement-only right now.'
  end as verdict;

-- Optional, and only if the migration ledger is readable to you: which of the three are recorded.
-- Run separately; the table lives in a schema the SQL editor may not expose.
--
--   select version, name from supabase_migrations.schema_migrations
--   where version in ('20261006164431', '20261006174407', '20261006174711')
--   order by version;
