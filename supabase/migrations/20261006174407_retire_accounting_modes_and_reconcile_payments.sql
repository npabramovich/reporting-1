-- Explicit decisions about manual payment representations. Only scoped server APIs access this.
create table public.capital_settlement_reviews (
  fund_id uuid not null references public.funds(id),
  vehicle_id uuid not null references public.fund_vehicles(id),
  kind text not null check (kind in ('call', 'distribution')),
  line_id uuid not null,
  lp_entity_id uuid not null references public.lp_entities(id),
  manual_amount numeric not null check (manual_amount > 0),
  manual_date date not null,
  links jsonb not null default '[]',
  separate_remainder boolean not null default false,
  reviewed_by uuid not null,
  reviewed_at timestamptz not null default now(),
  primary key (fund_id, vehicle_id, kind, line_id)
);
alter table public.capital_settlement_reviews enable row level security;
revoke all on public.capital_settlement_reviews from public;
revoke all on public.capital_settlement_reviews from anon, authenticated;
grant select, insert, update, delete on public.capital_settlement_reviews to service_role;
create index capital_settlement_reviews_partner on public.capital_settlement_reviews(fund_id, vehicle_id, kind, lp_entity_id);

create or replace function public.review_capital_settlement(
  p_fund_id uuid, p_vehicle_id uuid, p_kind text, p_line_id uuid,
  p_links jsonb, p_separate boolean, p_user_id uuid
) returns void language plpgsql set search_path = public as $$
declare
  partner uuid; manual numeric; paid_on date; entry_id uuid; allocated numeric;
  entry_amount numeric; entry_date date; already_allocated numeric;
  total_linked numeric := 0; checked_links jsonb := '[]'; link jsonb;
begin
  -- Serialize all decisions for this entity/direction, including allocations of pooled wires.
  perform pg_advisory_xact_lock(hashtextextended(p_fund_id::text || ':' || p_vehicle_id::text || ':' || p_kind, 0));
  if p_kind = 'call' then
    select l.lp_entity_id, l.settled_amount, coalesce(l.settled_on, c.call_date)
      into partner, manual, paid_on from public.capital_call_lines l join public.capital_calls c on c.id = l.call_id
      where l.id = p_line_id and l.fund_id = p_fund_id and c.fund_id = p_fund_id and c.vehicle_id = p_vehicle_id and c.status = 'issued' for update of l;
  elsif p_kind = 'distribution' then
    select l.lp_entity_id, l.settled_amount, coalesce(l.settled_on, d.distribution_date)
      into partner, manual, paid_on from public.distribution_lines l join public.distributions d on d.id = l.distribution_id
      where l.id = p_line_id and l.fund_id = p_fund_id and d.fund_id = p_fund_id and d.vehicle_id = p_vehicle_id and d.status = 'declared' for update of l;
  else raise exception 'Invalid payment kind'; end if;
  if partner is null or manual is null or manual <= 0 then raise exception 'No recorded payment on this line'; end if;
  if jsonb_typeof(p_links) <> 'array' then raise exception 'Payment links must be an array'; end if;
  if (select count(*) from jsonb_array_elements(p_links)) <> (select count(distinct x->>'entryId') from jsonb_array_elements(p_links) x) then raise exception 'Duplicate payment link'; end if;
  for link in select * from jsonb_array_elements(p_links) loop
    entry_id := (link->>'entryId')::uuid; allocated := (link->>'amount')::numeric;
    if allocated is null or allocated <= 0 or allocated <> round(allocated, 2) then raise exception 'A positive cent amount is required'; end if;
    perform 1 from public.journal_entries where id = entry_id and fund_id = p_fund_id and vehicle_id = p_vehicle_id for update;
    select sum(case when p_kind = 'call' then -p.amount else p.amount end), e.entry_date
      into entry_amount, entry_date
      from public.journal_entries e join public.journal_postings p on p.journal_entry_id = e.id
      join public.chart_of_accounts a on a.id = p.account_id
      where e.id = entry_id and e.fund_id = p_fund_id and e.vehicle_id = p_vehicle_id and e.book = 'actual' and e.status = 'posted'
        and p.fund_id = p_fund_id and p.vehicle_id = p_vehicle_id and p.book = 'actual' and p.lp_entity_id = partner
        and a.fund_id = p_fund_id and a.vehicle_id = p_vehicle_id and a.code = case when p_kind = 'call' then '1300' else '2300' end
      group by e.entry_date;
    if entry_amount is null or entry_amount <= 0 then raise exception 'Choose a posted payment for this partner and entity'; end if;
    select coalesce(sum((x->>'amount')::numeric), 0) into already_allocated
      from public.capital_settlement_reviews r cross join lateral jsonb_array_elements(r.links) x
      where r.fund_id = p_fund_id and r.vehicle_id = p_vehicle_id and r.kind = p_kind and r.lp_entity_id = partner
        and r.line_id <> p_line_id and x->>'entryId' = entry_id::text;
    if already_allocated + allocated > entry_amount then raise exception 'This payment amount is already allocated'; end if;
    total_linked := total_linked + allocated;
    checked_links := checked_links || jsonb_build_array(jsonb_build_object('entryId', entry_id, 'amount', allocated, 'entryAmount', entry_amount, 'date', entry_date));
  end loop;
  if total_linked > manual or (total_linked <> manual and not p_separate) then
    raise exception 'Link the full recorded amount or confirm the remainder is a separate payment';
  end if;
  insert into public.capital_settlement_reviews(fund_id, vehicle_id, kind, line_id, lp_entity_id, manual_amount, manual_date, links, separate_remainder, reviewed_by)
    values(p_fund_id, p_vehicle_id, p_kind, p_line_id, partner, manual, paid_on, checked_links, p_separate, p_user_id)
    on conflict (fund_id, vehicle_id, kind, line_id) do update set lp_entity_id = excluded.lp_entity_id, manual_amount = excluded.manual_amount, manual_date = excluded.manual_date,
      links = excluded.links, separate_remainder = excluded.separate_remainder, reviewed_by = excluded.reviewed_by, reviewed_at = now();
end;
$$;
revoke all on function public.review_capital_settlement(uuid, uuid, text, uuid, jsonb, boolean, uuid) from public, anon, authenticated;
grant execute on function public.review_capital_settlement(uuid, uuid, text, uuid, jsonb, boolean, uuid) to service_role;

create table public.capital_settlement_review_history (
  id bigint generated always as identity primary key,
  fund_id uuid not null references public.funds(id),
  vehicle_id uuid not null references public.fund_vehicles(id),
  decision jsonb not null,
  recorded_at timestamptz not null default now()
);
alter table public.capital_settlement_review_history enable row level security;
revoke all on public.capital_settlement_review_history from public;
revoke all on public.capital_settlement_review_history from anon, authenticated;
grant select, insert on public.capital_settlement_review_history to service_role;
grant usage on sequence public.capital_settlement_review_history_id_seq to service_role;
create index capital_settlement_review_history_entity on public.capital_settlement_review_history(fund_id, vehicle_id);
create function public.record_capital_settlement_review() returns trigger language plpgsql set search_path = public as $$
begin
  insert into public.capital_settlement_review_history(fund_id, vehicle_id, decision) values(new.fund_id, new.vehicle_id, to_jsonb(new));
  return new;
end;
$$;
create trigger capital_settlement_review_audit after insert or update on public.capital_settlement_reviews
for each row execute function public.record_capital_settlement_review();

-- A retried request reuses its register; concurrent requests cannot publish a second operation.
alter table public.capital_calls add column request_key text;
alter table public.distributions add column request_key text;
create unique index capital_call_request_once on public.capital_calls(fund_id, vehicle_id, request_key) where request_key is not null;
create unique index distribution_request_once on public.distributions(fund_id, vehicle_id, request_key) where request_key is not null;
-- Audit history is append-only even for the server role.
revoke update, delete, truncate on public.capital_settlement_review_history from service_role;

-- Resume and publish under the register lock. Lines and entries become visible together.
create or replace function public.complete_capital_operation(
  p_fund_id uuid, p_vehicle_id uuid, p_kind text, p_register_id uuid, p_entry_ids uuid[], p_lines jsonb
) returns void language plpgsql set search_path = public as $$
declare
  register_state text;
  linked_ids uuid[];
  existing_count integer;
  expected_count integer;
  capital_sign integer;
begin
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'Recipients are required'; end if;
  expected_count := jsonb_array_length(p_lines);
  if exists (select 1 from jsonb_to_recordset(p_lines) x("lpEntityId" uuid, amount numeric, role text)
    where x.amount is null or x.amount <= 0 or x.amount::text in ('NaN', 'Infinity', '-Infinity') or x.amount <> round(x.amount, 2)
      or not exists (select 1 from public.lp_entities e where e.id = x."lpEntityId" and e.fund_id = p_fund_id)) then
    raise exception 'Recipients and amounts must be valid for this fund';
  end if;
  if (select count(distinct x->>'lpEntityId') from jsonb_array_elements(p_lines) x) <> expected_count then raise exception 'Duplicate recipient'; end if;
  if p_kind = 'call' then
    select status, array[journal_entry_id] into register_state, linked_ids from public.capital_calls
      where id = p_register_id and fund_id = p_fund_id and vehicle_id = p_vehicle_id for update;
    capital_sign := -1;
  elsif p_kind = 'distribution' then
    select status, array_remove(array[journal_entry_id, carry_journal_entry_id], null) into register_state, linked_ids from public.distributions
      where id = p_register_id and fund_id = p_fund_id and vehicle_id = p_vehicle_id for update;
    capital_sign := 1;
    if exists (select 1 from jsonb_array_elements(p_lines) x where x->>'role' not in ('lp','carry') or x->>'role' is null) then raise exception 'Invalid recipient role'; end if;
  else raise exception 'Unknown capital operation'; end if;
  if register_state is null or linked_ids is null or cardinality(p_entry_ids) = 0 or not (linked_ids @> p_entry_ids and p_entry_ids @> linked_ids) then raise exception 'Capital operation scope or entries do not match'; end if;

  -- Freeze entry contents while checking the full partner totals, then use existing lock/balance triggers.
  perform 1 from public.journal_entries where id = any(p_entry_ids) order by id for update;
  if exists (
    with expected as (select "lpEntityId" id, amount from jsonb_to_recordset(p_lines) x("lpEntityId" uuid, amount numeric)),
    booked as (
      select a.lp_entity_id id, sum(p.amount) * capital_sign amount
      from public.journal_postings p join public.chart_of_accounts a on a.id = p.account_id
      where p.journal_entry_id = any(p_entry_ids) and p.fund_id = p_fund_id and p.vehicle_id = p_vehicle_id and p.book = 'actual'
        and a.fund_id = p_fund_id and a.vehicle_id = p_vehicle_id and a.type = 'equity' and a.subtype = 'lp_capital'
      group by a.lp_entity_id
    ) select 1 from expected full join booked using(id) where expected.amount is distinct from booked.amount
  ) then raise exception 'Recipient amounts do not match journal capital'; end if;

  if p_kind = 'call' then
    select count(*) into existing_count from public.capital_call_lines where call_id = p_register_id;
    if existing_count = 0 and register_state = 'draft' then
      insert into public.capital_call_lines(call_id, fund_id, vehicle_id, lp_entity_id, amount)
        select p_register_id, p_fund_id, p_vehicle_id, x."lpEntityId", x.amount from jsonb_to_recordset(p_lines) x("lpEntityId" uuid, amount numeric);
    elsif existing_count <> expected_count or exists (
      select 1 from jsonb_to_recordset(p_lines) x("lpEntityId" uuid, amount numeric)
      where not exists (select 1 from public.capital_call_lines l where l.call_id = p_register_id and l.fund_id = p_fund_id and l.vehicle_id = p_vehicle_id and l.lp_entity_id = x."lpEntityId" and l.amount = x.amount)
    ) then raise exception 'Recorded call recipients differ from this request'; end if;
  else
    select count(*) into existing_count from public.distribution_lines where distribution_id = p_register_id;
    if existing_count = 0 and register_state = 'draft' then
      insert into public.distribution_lines(distribution_id, fund_id, vehicle_id, lp_entity_id, amount, role)
        select p_register_id, p_fund_id, p_vehicle_id, x."lpEntityId", x.amount, x.role from jsonb_to_recordset(p_lines) x("lpEntityId" uuid, amount numeric, role text);
    elsif existing_count <> expected_count or exists (
      select 1 from jsonb_to_recordset(p_lines) x("lpEntityId" uuid, amount numeric, role text)
      where not exists (select 1 from public.distribution_lines l where l.distribution_id = p_register_id and l.fund_id = p_fund_id and l.vehicle_id = p_vehicle_id and l.lp_entity_id = x."lpEntityId" and l.amount = x.amount and l.role = x.role)
    ) then raise exception 'Recorded distribution recipients differ from this request'; end if;
  end if;
  if register_state = 'draft' then
    perform public.finalize_capital_operation(p_fund_id, p_vehicle_id, p_kind, p_register_id, p_entry_ids);
  elsif (p_kind = 'call' and register_state <> 'issued') or (p_kind = 'distribution' and register_state <> 'declared') then
    raise exception 'Capital operation cannot be published in this state';
  end if;
end;
$$;
revoke all on function public.complete_capital_operation(uuid, uuid, text, uuid, uuid[], jsonb) from public, anon, authenticated;
grant execute on function public.complete_capital_operation(uuid, uuid, text, uuid, uuid[], jsonb) to service_role;

-- Clean up a failed/losing preparation only if no register claimed its draft entries.
create or replace function public.discard_unregistered_capital_drafts(p_fund_id uuid, p_vehicle_id uuid, p_entry_ids uuid[])
returns void language sql set search_path = public as $$
  delete from public.journal_entries e where e.fund_id = p_fund_id and e.vehicle_id = p_vehicle_id and e.book = 'actual'
    and e.id = any(p_entry_ids) and e.status = 'draft' and e.source_type in ('capital_call','distribution','carry_distribution')
    and not exists (select 1 from public.capital_calls c where c.journal_entry_id = e.id)
    and not exists (select 1 from public.distributions d where d.journal_entry_id = e.id or d.carry_journal_entry_id = e.id);
$$;
revoke all on function public.discard_unregistered_capital_drafts(uuid, uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.discard_unregistered_capital_drafts(uuid, uuid, uuid[]) to service_role;
