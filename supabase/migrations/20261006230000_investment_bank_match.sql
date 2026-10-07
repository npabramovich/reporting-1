-- The books follow the investments (plans/spec-books-follow-investments.md).
--
-- An entry derived from a tracker transaction that moves cash — a purchase, an exit, cash income —
-- waits as a draft until its cash leg is matched to the bank_transactions row that is the same
-- payment. Additive and re-runnable; no new table, so no Data API grants.
--
-- 1. ONE BANK ROW PER ENTRY. If two bank rows could claim one entry, both would read "reconciled"
--    while the ledger carried the payment once. linkInflowToEntry checks this in application code
--    for posted entries only; this makes it true for every entry. journal_entries.id is a uuid
--    primary key, so the entry id alone is the key — scoping it by fund and vehicle would add
--    nothing but nullable columns to reason about.
--
--    Existing data that already breaks the rule is reported by name, not silently left behind:
--    the index would fail anyway, and "could not create unique index" says nothing about which
--    rows to look at.
do $$
declare
  dupes text;
begin
  select string_agg(journal_entry_id::text || ' (' || n || ' bank rows)', ', ')
    into dupes
    from (
      select journal_entry_id, count(*) as n
        from public.bank_transactions
       where journal_entry_id is not null
       group by journal_entry_id
      having count(*) > 1
    ) d;
  if dupes is not null then
    raise exception 'Bank transactions share a journal entry, so one payment reads reconciled twice: %. Unlink the extra rows on the bank page, then re-run.', dupes;
  end if;
end $$;

create unique index if not exists bank_transactions_one_row_per_entry
  on public.bank_transactions (journal_entry_id)
  where journal_entry_id is not null;

-- 2. POSTED WITHOUT A BANK MATCH. A vehicle with no bank feed can never match, so its cash entries
--    are posted by an explicit decision — recorded here, by whom and when, never inferred from
--    whether a bank account exists. Connecting a feed later then shows exactly which postings
--    were made without one.
alter table public.journal_entries
  add column if not exists bank_match_waived_at timestamptz,
  add column if not exists bank_match_waived_by uuid references auth.users(id) on delete set null;

-- 3. ONE LIVE ENTRY PER TRACKER TRANSACTION. Derivation is keyed on source_ref = 'txn:<id>', and
--    marks now post on record — so two concurrent derivations of one transaction (two backfill
--    tabs, a backfill racing an edit) would post the appreciation twice. Voided history is
--    exempt: an edited transaction keeps its voided entries and derives a new one.
do $$
declare
  dupes text;
begin
  select string_agg(source_ref || ' (' || n || ' entries)', ', ')
    into dupes
    from (
      select source_ref, count(*) as n
        from public.journal_entries
       where source_ref like 'txn:%' and status <> 'void'
       group by source_ref
      having count(*) > 1
    ) d;
  if dupes is not null then
    raise exception 'Tracker transactions have more than one live journal entry: %. Void the extras in the journal, then re-run.', dupes;
  end if;
end $$;

create unique index if not exists journal_entries_one_live_entry_per_txn
  on public.journal_entries (source_ref)
  where source_ref like 'txn:%' and status <> 'void';
