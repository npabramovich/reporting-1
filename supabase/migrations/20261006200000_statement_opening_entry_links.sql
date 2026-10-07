-- Which statement observation an opening entry REPRESENTS.
--
-- A cutover is the point of this: start the books at a dated statement instead of importing the
-- whole history. Until now that identity was inferred, two ways, and both were heuristics:
--
--   * `resolveCapitalEvidence` decided an opening entry was "the statement" by checking that the
--     ledger's computed account at the observation date equalled the observation on all three
--     fields. A cutover whose books legitimately differ by a cent, or whose statement left a field
--     unstated, never tied — so the vehicle stayed pinned to the reported basis forever, with its
--     real books ignored.
--   * `openingOnly` was a regex over `source_type` (/opening|bootstrap|cutover/).
--
-- And non-duplication rested on `journal_entries_partner_opening_once` (20261006164431), which
-- allows exactly ONE partner-opening entry per vehicle, ever. That is the wrong shape for the
-- actual workflow: a partner admitted after the cutover can then never be opened at all, and a
-- vehicle can never be restated at a second date.
--
-- This replaces inference with a recorded fact: one row per (vehicle, partner) naming the
-- `lp_positions` observation and the journal entry that represents it, with BOTH figures frozen at
-- link time so a later edit to either side makes the link detectably stale rather than silently
-- wrong — the same discipline `capital_settlement_reviews.links` uses for payments.

create table if not exists public.capital_opening_links (
  fund_id          uuid not null references public.funds(id) on delete cascade,
  vehicle_id       uuid not null references public.fund_vehicles(id) on delete cascade,
  lp_entity_id     uuid not null references public.lp_entities(id) on delete cascade,
  -- The observation this entry is a representation OF.
  position_id      uuid not null references public.lp_positions(id) on delete cascade,
  journal_entry_id uuid not null references public.journal_entries(id) on delete cascade,
  -- Frozen at link time. `observed_nav` is what the statement said; `booked_amount` is what the
  -- entry posted to this partner's capital. Equal at link time unless the entry was deliberately
  -- booked to a different figure, and comparing them against the live rows later is what detects
  -- a restated statement or an edited entry.
  observed_nav     numeric,
  booked_amount    numeric not null,
  observed_on      date not null,
  created_at       timestamptz not null default now(),
  created_by       uuid,
  -- One opening per partner per vehicle. Several cutover DATES across a vehicle are fine; one
  -- partner being opened twice is not.
  primary key (fund_id, vehicle_id, lp_entity_id),
  -- And one observation is represented at most once, so it cannot anchor twice.
  unique (position_id)
);

create index if not exists capital_opening_links_entry on public.capital_opening_links(journal_entry_id);

-- Grants: the only reader is the server-side evidence resolver, through the service-role admin
-- client, and the rows name partners and their capital. Service role alone, no `authenticated`
-- policies, so RLS denies by default if a grant ever creeps back (CLAUDE.md).
alter table public.capital_opening_links enable row level security;
revoke all on public.capital_opening_links from public;
revoke all on public.capital_opening_links from anon, authenticated;
grant select, insert, update, delete on public.capital_opening_links to service_role;

-- Several cutover dates are now allowed; two opening entries on ONE date are still not, because
-- the route books every partner opened at a given date into a single entry.
drop index if exists public.journal_entries_partner_opening_once;
create unique index if not exists journal_entries_partner_opening_once_per_date
  on public.journal_entries (fund_id, vehicle_id, book, entry_date)
  where source_ref = 'partner-opening' and status <> 'void';

-- Link and publish together. The entry is prepared as a draft, exactly as calls and distributions
-- are, so a refused link leaves no posted opening behind.
create or replace function public.publish_opening_balances(
  p_fund_id uuid, p_vehicle_id uuid, p_entry_id uuid, p_user_id uuid
) returns jsonb language plpgsql set search_path = public as $$
declare
  opened_on date;
  partners integer;
  linked integer;
begin
  select entry_date into opened_on from public.journal_entries
    where id = p_entry_id and fund_id = p_fund_id and vehicle_id = p_vehicle_id
      and book = 'actual' and status = 'draft' and source_type = 'opening_balance'
    for update;
  if opened_on is null then raise exception 'No opening draft to publish for this entity'; end if;

  -- Each partner's opening capital, from the entry itself: the route credits the partner's own
  -- equity/lp_capital account, so the opening balance is the negated posting total. Same shape as
  -- complete_capital_operation's recipient check, deliberately.
  create temporary table opening_partners on commit drop as
    select a.lp_entity_id as lp_entity_id, -sum(p.amount) as opening
      from public.journal_postings p join public.chart_of_accounts a on a.id = p.account_id
     where p.journal_entry_id = p_entry_id and p.fund_id = p_fund_id and p.vehicle_id = p_vehicle_id
       and p.book = 'actual' and a.fund_id = p_fund_id and a.vehicle_id = p_vehicle_id
       and a.type = 'equity' and a.subtype = 'lp_capital' and a.lp_entity_id is not null
     group by a.lp_entity_id;
  select count(*) into partners from opening_partners;
  if partners = 0 then raise exception 'This opening entry posts no partner capital'; end if;

  -- Link every partner whose statement for THIS date is on file. A partner with no observation at
  -- this date is left unlinked rather than linked to a nearby one: a cutover date that does not
  -- match a statement date is not a representation of that statement, and guessing the identity
  -- from a close date is exactly the inference this table exists to remove.
  insert into public.capital_opening_links
    (fund_id, vehicle_id, lp_entity_id, position_id, journal_entry_id, observed_nav, booked_amount, observed_on, created_by)
  select p_fund_id, p_vehicle_id, o.lp_entity_id, pos.id, p_entry_id, pos.nav, o.opening, pos.as_of_date, p_user_id
    from opening_partners o
    join public.lp_positions pos
      on pos.fund_id = p_fund_id and pos.vehicle_id = p_vehicle_id
     and pos.lp_entity_id = o.lp_entity_id and pos.as_of_date = opened_on;
  linked := (select count(*) from public.capital_opening_links where journal_entry_id = p_entry_id);

  -- Existing ledger triggers enforce balance and the closed-period lock on this transition.
  update public.journal_entries set status = 'posted', posted_at = now() where id = p_entry_id;
  return jsonb_build_object('entryId', p_entry_id, 'partners', partners, 'linked', linked, 'openedOn', opened_on);
end;
$$;
revoke all on function public.publish_opening_balances(uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.publish_opening_balances(uuid, uuid, uuid, uuid) to service_role;

-- Clean up a preparation whose publication failed, and only that: never an entry a link claims.
create or replace function public.discard_unpublished_opening_draft(p_fund_id uuid, p_vehicle_id uuid, p_entry_id uuid)
returns void language sql set search_path = public as $$
  delete from public.journal_entries e
   where e.id = p_entry_id and e.fund_id = p_fund_id and e.vehicle_id = p_vehicle_id
     and e.book = 'actual' and e.status = 'draft' and e.source_type = 'opening_balance'
     and not exists (select 1 from public.capital_opening_links l where l.journal_entry_id = e.id);
$$;
revoke all on function public.discard_unpublished_opening_draft(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.discard_unpublished_opening_draft(uuid, uuid, uuid) to service_role;
