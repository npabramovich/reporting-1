-- A stale settlement review must not strand a payment.
--
-- `review_capital_settlement` (20261006174407) counted every OTHER line's allocation against a
-- wire regardless of whether that review still described its line's current manual record. Edit or
-- remove a line's recorded payment and its review goes stale — but that line can then no longer be
-- re-reviewed to release its claim, because the function refuses a line with no recorded payment
-- (`manual <= 0`). The allocation it was holding could never be freed, and nothing could ever be
-- matched against that wire again.
--
-- Reads already treat such a review as unresolved rather than as evidence (`reconcileSettlements`
-- in lib/accounting/settlement.ts compares the stored manualAmount/manualDate against the current
-- record and reopens review when they differ). This makes the write side agree: only a review that
-- still describes its line's current manual record holds an allocation. A stale one releases its
-- claim, and re-asserts it if the manual record comes back.
--
-- Also splits one misleading message into two. Asking to match 90 against an 80 wire used to say
-- "This payment amount is already allocated" when nothing was allocated at all; the reviewer either
-- asked for more than the payment IS, or more than is LEFT of it after another line took its share.
--
-- `create or replace` keeps the existing grants and the revoke from public/anon/authenticated;
-- they are re-asserted below anyway so this file states the whole posture on its own.
-- 20261006174407 is already applied and is not edited (CLAUDE.md).

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
    -- Only a review that still describes its line's CURRENT manual record holds an allocation.
    select coalesce(sum((x->>'amount')::numeric), 0) into already_allocated
      from public.capital_settlement_reviews r cross join lateral jsonb_array_elements(r.links) x
      where r.fund_id = p_fund_id and r.vehicle_id = p_vehicle_id and r.kind = p_kind and r.lp_entity_id = partner
        and r.line_id <> p_line_id and x->>'entryId' = entry_id::text
        and exists (
          select 1 from public.capital_call_lines l join public.capital_calls c on c.id = l.call_id
            where p_kind = 'call' and l.id = r.line_id and l.fund_id = r.fund_id and l.lp_entity_id = r.lp_entity_id
              and l.settled_amount = r.manual_amount and coalesce(l.settled_on, c.call_date) = r.manual_date
          union all
          select 1 from public.distribution_lines l join public.distributions d on d.id = l.distribution_id
            where p_kind = 'distribution' and l.id = r.line_id and l.fund_id = r.fund_id and l.lp_entity_id = r.lp_entity_id
              and l.settled_amount = r.manual_amount and coalesce(l.settled_on, d.distribution_date) = r.manual_date
        );
    -- Two different mistakes, two different messages.
    if already_allocated > 0 and already_allocated + allocated > entry_amount then
      raise exception 'Only % of this payment is still unallocated; % is already matched to another line',
        to_char(entry_amount - already_allocated, 'FM999999999990.00'), to_char(already_allocated, 'FM999999999990.00');
    elsif allocated > entry_amount then
      raise exception 'This payment is only %, so % cannot be matched to it',
        to_char(entry_amount, 'FM999999999990.00'), to_char(allocated, 'FM999999999990.00');
    end if;
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
