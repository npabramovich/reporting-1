-- Additive rollout. Keep legacy capital_source/history_mode columns for older deployments,
-- but new code neither reads nor writes them. Remove in a later deployment after client audit.
-- Existing reports retain the historical definition; new frozen live reports set capital-v1.
alter table public.lp_snapshots
  add column if not exists reporting_definition text not null default 'legacy';

-- Explicit overlap link; do not infer payment identity from equal dates and amounts.
alter table public.carry_payments
  add column if not exists journal_entry_id uuid references public.journal_entries(id);
create unique index if not exists carry_payment_posting_link
  on public.carry_payments(fund_id, vehicle_id, lp_entity_id, journal_entry_id)
  where journal_entry_id is not null;
-- Existing table grants/RLS remain in force. Linked entry tenancy is checked by the write API.
comment on column public.carry_payments.journal_entry_id is
  'The ledger representation of this payment. Excluded from duplicate summation while that entry is posted.';
comment on column public.vehicle_accounting_settings.capital_source is
  'Deprecated legacy provenance preference. Unified reporting resolves evidence per partner and date; this column no longer enables features.';

-- A retry or concurrent request cannot book the same opening capital operation twice.
create unique index if not exists journal_entries_partner_opening_once
  on public.journal_entries (fund_id, vehicle_id, book)
  where source_ref = 'partner-opening' and status <> 'void';

alter table public.qb_import_runs add column if not exists reconciliation_review jsonb;

-- Serialize new QuickBooks representations without modifying historical entries.
create or replace function public.prevent_duplicate_qb_import() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.source_ref like 'qb:%' and new.status <> 'void' then
    perform pg_advisory_xact_lock(hashtextextended(new.fund_id::text || ':' || new.vehicle_id::text || ':' || new.book || ':' || new.source_ref, 0));
    if exists (select 1 from public.journal_entries e where e.fund_id = new.fund_id and e.vehicle_id = new.vehicle_id and e.book = new.book and e.source_ref = new.source_ref and e.status <> 'void' and e.id <> new.id) then
      raise exception 'This QuickBooks transaction has already been imported';
    end if;
  end if;
  return new;
end;
$$;
create trigger journal_entries_prevent_duplicate_qb_import before insert on public.journal_entries
for each row execute function public.prevent_duplicate_qb_import();

-- Freeze header and rows together. A failed row insert must not leave a shareable empty report.
create or replace function public.freeze_live_report(
  p_fund_id uuid, p_name text, p_as_of date, p_description text, p_footer text, p_rows jsonb
) returns jsonb language plpgsql set search_path = public as $$
declare
  snapshot_id uuid;
  was_created boolean;
begin
  if exists (
    select 1 from jsonb_array_elements(p_rows) r
    where not exists (select 1 from public.lp_entities e where e.id = (r->>'entity_id')::uuid and e.fund_id = p_fund_id)
  ) then raise exception 'Report contains an entity outside this fund'; end if;
  insert into public.lp_snapshots (fund_id, name, as_of_date, description, footer_note, reporting_definition)
  values (p_fund_id, p_name, p_as_of, p_description, p_footer, 'capital-v1')
  on conflict (fund_id, name) do nothing returning id into snapshot_id;
  was_created := snapshot_id is not null;
  if was_created then
    insert into public.lp_investments (fund_id, snapshot_id, entity_id, portfolio_group, commitment, called_capital, paid_in_capital, distributions, nav, total_value, outstanding_balance, dpi, rvpi, tvpi, irr)
    select p_fund_id, snapshot_id, x.entity_id, x.portfolio_group, x.commitment, x.called_capital, x.paid_in_capital, x.distributions, x.nav, x.total_value, x.outstanding_balance, x.dpi, x.rvpi, x.tvpi, x.irr
    from jsonb_to_recordset(p_rows) as x(entity_id uuid, portfolio_group text, commitment numeric, called_capital numeric, paid_in_capital numeric, distributions numeric, nav numeric, total_value numeric, outstanding_balance numeric, dpi numeric, rvpi numeric, tvpi numeric, irr numeric);
  else
    select id into snapshot_id from public.lp_snapshots where fund_id = p_fund_id and name = p_name;
  end if;
  return jsonb_build_object('snapshotId', snapshot_id, 'name', p_name, 'created', was_created);
end;
$$;
revoke all on function public.freeze_live_report(uuid, text, date, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.freeze_live_report(uuid, text, date, text, text, jsonb) to service_role;

alter table public.carry_payments add column if not exists separate_from_ledger boolean not null default false;

-- Calls/distributions are prepared as drafts; publish the register and all its entries together.
create or replace function public.finalize_capital_operation(p_fund_id uuid, p_vehicle_id uuid, p_kind text, p_register_id uuid, p_entry_ids uuid[])
returns void language plpgsql set search_path = public as $$
declare
  linked_ids uuid[];
begin
  if cardinality(p_entry_ids) = 0 then raise exception 'At least one entry is required'; end if;
  perform 1 from public.journal_entries where id = any(p_entry_ids) order by id for update;
  if (select count(*) from public.journal_entries where id = any(p_entry_ids) and fund_id = p_fund_id and vehicle_id = p_vehicle_id and book = 'actual' and status = 'draft') <> cardinality(p_entry_ids) then
    raise exception 'Every entry must be a draft on this entity';
  end if;
  if p_kind = 'call' then
    select array[journal_entry_id] into linked_ids from public.capital_calls where id = p_register_id and fund_id = p_fund_id and vehicle_id = p_vehicle_id and status = 'draft' for update;
    if not exists (select 1 from public.capital_call_lines where call_id = p_register_id and fund_id = p_fund_id) then raise exception 'Call has no recipients'; end if;
    if linked_ids is null or not (linked_ids @> p_entry_ids and p_entry_ids @> linked_ids) then raise exception 'Call entries do not match'; end if;
    update public.capital_calls set status = 'issued' where id = p_register_id;
  elsif p_kind = 'distribution' then
    select array_remove(array[journal_entry_id, carry_journal_entry_id], null) into linked_ids from public.distributions where id = p_register_id and fund_id = p_fund_id and vehicle_id = p_vehicle_id and status = 'draft' for update;
    if not exists (select 1 from public.distribution_lines where distribution_id = p_register_id and fund_id = p_fund_id) then raise exception 'Distribution has no recipients'; end if;
    if linked_ids is null or not (linked_ids @> p_entry_ids and p_entry_ids @> linked_ids) then raise exception 'Distribution entries do not match'; end if;
    update public.distributions set status = 'declared' where id = p_register_id;
  else raise exception 'Unknown capital operation'; end if;
  -- Existing ledger triggers enforce balancing and period locks on this transition.
  update public.journal_entries set status = 'posted', posted_at = now() where id = any(p_entry_ids);
end;
$$;
revoke all on function public.finalize_capital_operation(uuid, uuid, text, uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.finalize_capital_operation(uuid, uuid, text, uuid, uuid[]) to service_role;
