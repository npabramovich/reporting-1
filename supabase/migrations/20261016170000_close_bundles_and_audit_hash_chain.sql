-- Every period close independently verifiable, and the books' audit trail tamper-evident.
--
-- 1. close_bundles — one reproducibility bundle per close: the close's ledger snapshot, the
--    vehicle's terms as the open fund engine reads them, the engine's statements, and a manifest
--    with the SHA-256 of each (packages/fund-engine/src/bundle.ts). The bundle's hash (the manifest's
--    SHA-256) is also kept on the period (fiscal_periods.close_bundle_sha256) and in the
--    period.close audit event.
--
--    A table, not storage: a bundle is a few text files that must be written atomically with the
--    close and served behind the same gate as the close review; storage would need a bucket and
--    policies on every fresh install and could be emptied separately from the row that names it.
--    It is append-only: a re-close writes a new bundle, and a reopen leaves the old one as the
--    record of what that close produced.
--
-- 2. accounting_audit_events hash chain — per fund, each new row stores chain_seq, prev_hash (the
--    previous row's row_hash; 64 zeros for the first) and row_hash = sha256(prev_hash || canonical
--    JSON of the row's content). Computed by a BEFORE INSERT trigger, so every writer is covered,
--    serialized per fund by a transaction-scoped advisory lock. Existing rows are chained here in
--    (created_at, id) order. verify_accounting_audit_chain walks a fund's chain and reports the
--    first break. The same hash in TypeScript: packages/fund-engine/src/audit-chain.ts.
--
-- Not deploy-dependent: the app tolerates both the table and the columns being absent (the close
-- records its bundle best-effort and says so), and nothing the current release does changes.

-- ── 1. Close bundles ────────────────────────────────────────────────────────────────────────

create table if not exists public.close_bundles (
  id                uuid primary key default gen_random_uuid(),
  fund_id           uuid not null references public.funds(id) on delete cascade,
  vehicle_id        uuid not null references public.fund_vehicles(id) on delete cascade,
  -- No foreign key: a superseded period row is deleted by a later close, and the bundle is the
  -- record of what that close produced. Same reasoning as accounting_audit_events.subject_id.
  fiscal_period_id  uuid not null,
  period_start      date not null,
  period_end        date not null,
  -- SHA-256 (hex) of manifest_json: the bundle's identity.
  bundle_sha256     text not null check (bundle_sha256 ~ '^[0-9a-f]{64}$'),
  engine_version    text not null,
  manifest_json     text not null,
  ledger_text       text not null,
  terms_json        text not null,
  statements_json   text not null,
  -- The audit trail's head when the bundle was built (also in the manifest).
  audit_head_seq    bigint,
  audit_head_hash   text,
  created_by        uuid,
  created_at        timestamptz not null default now()
);

create index if not exists close_bundles_period_idx on public.close_bundles (fund_id, fiscal_period_id, created_at desc);
create index if not exists close_bundles_vehicle_idx on public.close_bundles (fund_id, vehicle_id, period_end desc);

-- Service role only, reads included: the one reader is the gated close-bundle route (accounting,
-- plus lp_capital and gp_economics, since a bundle holds every partner's capital and the carry).
-- No authenticated grant and no authenticated policy — see CLAUDE.md on gated tables.
revoke all on public.close_bundles from anon, authenticated;
grant select, insert on public.close_bundles to service_role;
alter table public.close_bundles enable row level security;
create policy "close_bundles service role read" on public.close_bundles for select to service_role using (true);
create policy "close_bundles service role insert" on public.close_bundles for insert to service_role with check (true);

-- Append-only, as accounting_audit_events: the one delete allowed is a cascade from the fund or
-- the vehicle (one trigger level down).
create or replace function public.close_bundles_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception 'close_bundles is append-only';
end $$;
revoke execute on function public.close_bundles_immutable() from public, anon, authenticated;

drop trigger if exists close_bundles_no_change on public.close_bundles;
create trigger close_bundles_no_change
  before update or delete on public.close_bundles
  for each row execute function public.close_bundles_immutable();

drop trigger if exists close_bundles_no_truncate on public.close_bundles;
create trigger close_bundles_no_truncate
  before truncate on public.close_bundles
  for each statement execute function public.refuse_truncate_append_only();

-- The hash of the bundle the close produced, on the close itself. Cleared on reopen with the snapshot.
alter table public.fiscal_periods add column if not exists close_bundle_sha256 text;

-- ── 2. Audit trail hash chain ───────────────────────────────────────────────────────────────

alter table public.accounting_audit_events add column if not exists chain_seq bigint;
alter table public.accounting_audit_events add column if not exists prev_hash text;
alter table public.accounting_audit_events add column if not exists row_hash text;

-- Canonical JSON text of a jsonb value: keys in byte order (COLLATE "C"), no whitespace, strings
-- with JSON escaping, numbers as plain decimals without trailing fractional zeros. Mirrored by
-- canonicalJson in packages/fund-engine/src/audit-chain.ts — change both or neither.
create or replace function public.canonical_jsonb(j jsonb)
returns text language plpgsql immutable set search_path = '' as $$
declare
  out text;
begin
  case jsonb_typeof(j)
    when 'object' then
      select '{' || coalesce(string_agg(to_json(k)::text || ':' || public.canonical_jsonb(v), ',' order by k collate "C"), '') || '}'
        into out from jsonb_each(j) as e(k, v);
    when 'array' then
      select '[' || coalesce(string_agg(public.canonical_jsonb(v), ',' order by o), '') || ']'
        into out from jsonb_array_elements(j) with ordinality as a(v, o);
    when 'string' then
      out := to_json(j #>> '{}')::text;
    when 'number' then
      out := trim_scale((j #>> '{}')::numeric)::text;
    else
      out := j::text; -- true, false, null
  end case;
  return out;
end $$;

-- What a row's hash covers: every column but the two hashes. created_at in UTC with microseconds,
-- so the text does not depend on the session's time zone.
create or replace function public.accounting_audit_event_content(e public.accounting_audit_events)
returns text language sql stable set search_path = '' as $$
  select public.canonical_jsonb(jsonb_build_object(
    'id', e.id,
    'fund_id', e.fund_id,
    'vehicle_id', e.vehicle_id,
    'actor_id', e.actor_id,
    'action', e.action,
    'subject_type', e.subject_type,
    'subject_id', e.subject_id,
    'reason', e.reason,
    'details', coalesce(e.details, '{}'::jsonb),
    'source', e.source,
    'created_at', to_char(e.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'chain_seq', e.chain_seq
  ))
$$;

create or replace function public.accounting_audit_chain_hash(prev_hash text, content text)
returns text language sql immutable set search_path = '' as $$
  select encode(sha256(convert_to(prev_hash || content, 'UTF8')), 'hex')
$$;

-- Chain each new row. The advisory lock is held to the end of the transaction, so the next writer
-- for this fund waits until this row is committed and then reads it as the previous row (a volatile
-- function takes a fresh snapshot per query under READ COMMITTED). The unique index below is the
-- backstop: a fork fails loudly rather than landing.
create or replace function public.accounting_audit_events_chain()
returns trigger language plpgsql set search_path = '' as $$
declare
  last_seq bigint;
  last_hash text;
begin
  perform pg_advisory_xact_lock(hashtextextended('accounting_audit_events:' || new.fund_id::text, 0));
  select e.chain_seq, e.row_hash into last_seq, last_hash
    from public.accounting_audit_events e
   where e.fund_id = new.fund_id and e.chain_seq is not null
   order by e.chain_seq desc
   limit 1;
  new.chain_seq := coalesce(last_seq, 0) + 1;
  new.prev_hash := coalesce(last_hash, repeat('0', 64));
  new.row_hash := public.accounting_audit_chain_hash(new.prev_hash, public.accounting_audit_event_content(new));
  return new;
end $$;
revoke execute on function public.accounting_audit_events_chain() from public, anon, authenticated;

-- Backfill: chain every existing row, per fund, in the order it was recorded. The append-only
-- trigger refuses any UPDATE, so it is switched off for exactly this statement block and back on
-- before the migration's transaction commits.
alter table public.accounting_audit_events disable trigger accounting_audit_events_no_change;
do $$
declare
  r public.accounting_audit_events;
  cur_fund uuid := null;
  seq bigint := 0;
  prev text := repeat('0', 64);
  h text;
begin
  for r in
    select e.* from public.accounting_audit_events e
     where e.chain_seq is null
     order by e.fund_id, e.created_at, e.id
  loop
    if cur_fund is distinct from r.fund_id then
      cur_fund := r.fund_id;
      select coalesce(max(x.chain_seq), 0) into seq from public.accounting_audit_events x where x.fund_id = r.fund_id;
      select coalesce((select x.row_hash from public.accounting_audit_events x where x.fund_id = r.fund_id and x.chain_seq = seq), repeat('0', 64)) into prev;
    end if;
    seq := seq + 1;
    r.chain_seq := seq;
    r.prev_hash := prev;
    h := public.accounting_audit_chain_hash(prev, public.accounting_audit_event_content(r));
    update public.accounting_audit_events
       set chain_seq = seq, prev_hash = prev, row_hash = h
     where id = r.id;
    prev := h;
  end loop;
end $$;
alter table public.accounting_audit_events enable trigger accounting_audit_events_no_change;

alter table public.accounting_audit_events alter column chain_seq set not null;
alter table public.accounting_audit_events alter column prev_hash set not null;
alter table public.accounting_audit_events alter column row_hash set not null;
create unique index if not exists accounting_audit_events_chain_seq on public.accounting_audit_events (fund_id, chain_seq);

drop trigger if exists accounting_audit_events_chain on public.accounting_audit_events;
create trigger accounting_audit_events_chain
  before insert on public.accounting_audit_events
  for each row execute function public.accounting_audit_events_chain();

-- Walk one fund's chain from the first row. ok = every row holds; otherwise the first break:
-- a missing or out-of-order sequence number, a prev_hash that is not the previous row's hash, or a
-- row whose content no longer matches its own hash. Rows cut off the END cannot show here — the
-- last row simply becomes the head — which is why a close bundle pins the head it saw.
create or replace function public.verify_accounting_audit_chain(p_fund_id uuid)
returns table (ok boolean, checked bigint, head_seq bigint, head_hash text, break_seq bigint, break_id uuid, problem text)
language plpgsql stable set search_path = '' as $$
declare
  r public.accounting_audit_events;
  expected_seq bigint := 1;
  expected_prev text := repeat('0', 64);
  n bigint := 0;
  recomputed text;
begin
  for r in
    select e.* from public.accounting_audit_events e where e.fund_id = p_fund_id order by e.chain_seq
  loop
    if r.chain_seq is distinct from expected_seq then
      return query select false, n, nullif(n, 0), case when n = 0 then null else expected_prev end, r.chain_seq, r.id,
        format('expected sequence %s, found %s: a row is missing, repeated or out of order', expected_seq, r.chain_seq);
      return;
    end if;
    if r.prev_hash is distinct from expected_prev then
      return query select false, n, nullif(n, 0), case when n = 0 then null else expected_prev end, r.chain_seq, r.id,
        'prev_hash is not the previous row''s hash: the chain was broken here'::text;
      return;
    end if;
    recomputed := public.accounting_audit_chain_hash(r.prev_hash, public.accounting_audit_event_content(r));
    if r.row_hash is distinct from recomputed then
      return query select false, n, nullif(n, 0), case when n = 0 then null else expected_prev end, r.chain_seq, r.id,
        'the row no longer matches its hash: its content was changed'::text;
      return;
    end if;
    n := n + 1;
    expected_prev := r.row_hash;
    expected_seq := expected_seq + 1;
  end loop;
  return query select true, n, nullif(n, 0), case when n = 0 then null else expected_prev end, null::bigint, null::uuid, null::text;
end $$;

revoke execute on function public.verify_accounting_audit_chain(uuid) from public, anon, authenticated;
grant execute on function public.verify_accounting_audit_chain(uuid) to service_role;
revoke execute on function public.accounting_audit_event_content(public.accounting_audit_events) from public, anon, authenticated;
revoke execute on function public.canonical_jsonb(jsonb) from public, anon, authenticated;
revoke execute on function public.accounting_audit_chain_hash(text, text) from public, anon, authenticated;
grant execute on function public.accounting_audit_event_content(public.accounting_audit_events) to service_role;
grant execute on function public.canonical_jsonb(jsonb) to service_role;
grant execute on function public.accounting_audit_chain_hash(text, text) to service_role;
