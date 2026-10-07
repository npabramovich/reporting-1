// Isolated schema for exercising the unified-accounting migrations' SQL.
//
// NOT the full Supabase schema. It is the subset the three migrations actually touch, written
// with the REAL column sets, types, defaults and check constraints of the production tables, so
// a function that references a column the real table does not have fails here rather than in
// production. The two ledger-enforcement migrations are executed verbatim, which is what gives
// these checks real balance and closed-period trigger behaviour rather than a mock of it.
//
// Two backends: PGlite (set PGLITE_MODULE) for a single-session correctness run, and a real
// PostgreSQL server (set PG_MODULE + PGHOST/PGPORT) for anything involving concurrent sessions.
// A single PGlite instance cannot demonstrate row-lock behaviour between transactions.

import { readFileSync } from 'node:fs'

export const migrationSql = name =>
  readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8')

/** Applied verbatim, in order, after the base tables exist. */
export const MIGRATIONS = [
  '20260714000004_ledger_db_enforcement.sql',
  '20260827000000_ledger_books.sql',
  '20261006164431_unified_accounting_evidence.sql',
  '20261006174407_retire_accounting_modes_and_reconcile_payments.sql',
  // Applied after the three above, which are already in the owner's database and must not be
  // edited in place (CLAUDE.md). Anything found wrong in them lands here instead.
  '20261006190000_settlement_review_stale_allocations.sql',
  '20261006200000_statement_opening_entry_links.sql',
]

export const RETIREMENT_MIGRATION = '20261006174711_retire_accounting_mode_columns.sql'

// Column sets mirror: 20260702000000_fund_accounting_ledger.sql (ledger + fiscal periods),
// 20260710000002_accounting_vehicle_id.sql (vehicle_id), 20260711000000_capital_calls.sql,
// 20260805000000_distributions_register_and_notices.sql, 20260919000000_distribution_waterfall.sql
// (distribution_lines.role), 20260919000001_register_line_settlement_and_notice.sql (settled_*).
// `book` is deliberately absent here: 20260827000000_ledger_books.sql adds it.
export const BASE_SCHEMA = `
-- Cluster-wide on a real server, so idempotent: a reused cluster already has them.
-- service_role is BYPASSRLS, as it is on Supabase — the revokes, not RLS, are what hold it back.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role bypassrls; end if;
  alter role service_role bypassrls;
end $$;

create table public.funds (
  id uuid primary key default gen_random_uuid(),
  currency text not null default 'USD'
);

create table public.fund_vehicles (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references funds(id) on delete cascade,
  name text not null,
  kind text not null default 'fund'
);

create table public.lp_entities (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references funds(id) on delete cascade,
  entity_name text not null default 'Partner'
);

create table public.fiscal_periods (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references funds(id) on delete cascade,
  portfolio_group text not null,
  vehicle_id uuid references fund_vehicles(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  label text,
  status text not null default 'open' check (status in ('open', 'closed')),
  closed_at timestamptz,
  closed_by uuid,
  snapshot_text text,
  created_at timestamptz not null default now(),
  unique (fund_id, portfolio_group, period_start, period_end)
);

create table public.chart_of_accounts (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references funds(id) on delete cascade,
  portfolio_group text not null,
  vehicle_id uuid references fund_vehicles(id) on delete cascade,
  code text not null,
  name text not null,
  type text not null check (type in ('asset', 'liability', 'equity', 'income', 'expense')),
  subtype text,
  parent_id uuid references chart_of_accounts(id) on delete set null,
  lp_entity_id uuid references lp_entities(id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (fund_id, portfolio_group, code)
);

create table public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references funds(id) on delete cascade,
  portfolio_group text not null,
  vehicle_id uuid references fund_vehicles(id) on delete cascade,
  entry_date date not null,
  memo text,
  source_type text,
  source_ref text,
  status text not null default 'draft' check (status in ('draft', 'posted', 'void')),
  period_id uuid references fiscal_periods(id) on delete set null,
  created_by uuid,
  posted_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.journal_postings (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references funds(id) on delete cascade,
  portfolio_group text not null,
  vehicle_id uuid references fund_vehicles(id) on delete cascade,
  journal_entry_id uuid not null references journal_entries(id) on delete cascade,
  account_id uuid not null references chart_of_accounts(id) on delete restrict,
  amount numeric(20, 2) not null,
  currency text not null default 'USD',
  lp_entity_id uuid references lp_entities(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.capital_calls (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references funds(id) on delete cascade,
  vehicle_id uuid references fund_vehicles(id) on delete cascade,
  call_date date not null,
  due_date date,
  call_number int,
  description text,
  scope text not null default 'fund_wide' check (scope in ('fund_wide', 'per_lp')),
  status text not null default 'issued' check (status in ('draft', 'issued')),
  journal_entry_id uuid references public.journal_entries(id) on delete set null,
  created_at timestamptz not null default now(),
  created_by uuid
);

create table public.capital_call_lines (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null references public.capital_calls(id) on delete cascade,
  fund_id uuid not null references funds(id) on delete cascade,
  vehicle_id uuid references fund_vehicles(id) on delete cascade,
  lp_entity_id uuid not null references lp_entities(id) on delete cascade,
  amount numeric not null,
  settled_amount numeric,
  settled_on date,
  created_at timestamptz not null default now()
);

create table public.distributions (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references funds(id) on delete cascade,
  vehicle_id uuid references fund_vehicles(id) on delete cascade,
  distribution_date date not null,
  distribution_number int,
  description text,
  scope text not null default 'fund_wide' check (scope in ('fund_wide', 'per_lp')),
  status text not null default 'declared' check (status in ('draft', 'declared')),
  journal_entry_id uuid references public.journal_entries(id) on delete set null,
  carry_journal_entry_id uuid references public.journal_entries(id) on delete set null,
  split_method text,
  kind text,
  char_return_of_capital numeric,
  char_realized_gain numeric,
  char_income numeric,
  created_at timestamptz not null default now(),
  created_by uuid
);

create table public.distribution_lines (
  id uuid primary key default gen_random_uuid(),
  distribution_id uuid not null references public.distributions(id) on delete cascade,
  fund_id uuid not null references funds(id) on delete cascade,
  vehicle_id uuid references fund_vehicles(id) on delete cascade,
  lp_entity_id uuid not null references lp_entities(id) on delete cascade,
  amount numeric not null,
  role text not null default 'lp' check (role in ('lp', 'carry')),
  settled_amount numeric,
  settled_on date,
  created_at timestamptz not null default now()
);

create table public.carry_payments (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references funds(id) on delete cascade,
  vehicle_id uuid references fund_vehicles(id) on delete cascade,
  lp_entity_id uuid references lp_entities(id) on delete cascade,
  amount numeric,
  paid_on date
);

create table public.lp_snapshots (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references funds(id) on delete cascade,
  name text not null,
  as_of_date date,
  description text,
  footer_note text,
  created_at timestamptz not null default now(),
  unique (fund_id, name)
);

create table public.lp_investments (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references funds(id) on delete cascade,
  snapshot_id uuid references lp_snapshots(id) on delete cascade,
  entity_id uuid references lp_entities(id) on delete set null,
  portfolio_group text,
  commitment numeric, called_capital numeric, paid_in_capital numeric,
  distributions numeric, nav numeric, total_value numeric,
  outstanding_balance numeric, dpi numeric, rvpi numeric, tvpi numeric, irr numeric
);

-- 20260716000000_lp_positions.sql: the dated reported observations an opening entry can represent.
create table public.lp_positions (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references funds(id) on delete cascade,
  vehicle_id uuid not null references fund_vehicles(id) on delete cascade,
  lp_entity_id uuid not null references lp_entities(id) on delete cascade,
  as_of_date date not null,
  commitment numeric, called_capital numeric, distributions numeric, nav numeric,
  imported_at timestamptz not null default now(),
  imported_by uuid,
  source text not null default 'manual' check (source in ('paste', 'manual', 'migrated')),
  unique (fund_id, vehicle_id, lp_entity_id, as_of_date)
);

create table public.qb_import_runs (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid references funds(id) on delete cascade
);

create table public.vehicle_accounting_settings (
  fund_id uuid not null references funds(id) on delete cascade,
  vehicle_id uuid references fund_vehicles(id) on delete cascade,
  capital_source text,
  history_mode text,
  primary key (fund_id, vehicle_id)
);

grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
grant select on all tables in schema public to anon;
`

/** Stable ids so failures name a recognisable row. */
export const IDS = {
  fund: '00000000-0000-0000-0000-0000000000f1',
  otherFund: '00000000-0000-0000-0000-0000000000f2',
  vehicle: '00000000-0000-0000-0000-0000000000b1',
  otherVehicle: '00000000-0000-0000-0000-0000000000b2',
  lpA: '00000000-0000-0000-0000-00000000011a',
  lpB: '00000000-0000-0000-0000-00000000011b',
  gp: '00000000-0000-0000-0000-00000000011c',
  foreignLp: '00000000-0000-0000-0000-00000000011f',
  receivable: '00000000-0000-0000-0000-0000000002a0',
  payable: '00000000-0000-0000-0000-0000000002b0',
  capA: '00000000-0000-0000-0000-0000000003a0',
  capB: '00000000-0000-0000-0000-0000000003b0',
  capGp: '00000000-0000-0000-0000-0000000003c0',
  user: '00000000-0000-0000-0000-0000000009a0',
}

export const GROUP = 'Fund I'

/** Base tables + the four migrations under test. */
export async function applySchema(db) {
  await db.exec(BASE_SCHEMA)
  for (const name of MIGRATIONS) await db.exec(migrationSql(name))
}

/**
 * One fund, one vehicle, two LPs, a GP carry recipient, a foreign LP in another fund, and the
 * chart accounts the capital paths require — the real codes and subtypes: 1300 Due from LPs,
 * 2300 Distributions payable, and per-partner `equity`/`lp_capital` accounts carrying
 * `lp_entity_id` (what `ensureCapitalAccounts` creates, and what `complete_capital_operation`
 * groups its booked totals by).
 */
export async function seedEntity(db) {
  const i = IDS
  await db.query('insert into funds(id) values ($1), ($2)', [i.fund, i.otherFund])
  await db.query('insert into fund_vehicles(id, fund_id, name) values ($1,$2,$3), ($4,$5,$3)',
    [i.vehicle, i.fund, GROUP, i.otherVehicle, i.otherFund])
  await db.query(`insert into lp_entities(id, fund_id, entity_name) values
    ($1,$2,'LP A'), ($3,$2,'LP B'), ($4,$2,'GP carry'), ($5,$6,'Foreign LP')`,
    [i.lpA, i.fund, i.lpB, i.gp, i.foreignLp, i.otherFund])
  await db.query(`insert into chart_of_accounts(id, fund_id, portfolio_group, vehicle_id, code, name, type, subtype, lp_entity_id) values
    ($1,$2,$3,$4,'1300','Due from LPs','asset','lp_receivable',null),
    ($5,$2,$3,$4,'2300','Distributions payable','liability','distribution_payable',null),
    ($6,$2,$3,$4,'3100-a',$9,'equity','lp_capital',$7),
    ($8,$2,$3,$4,'3100-b','Partners'' capital — LP B','equity','lp_capital',$10),
    ($11,$2,$3,$4,'3100-c','Partners'' capital — GP carry','equity','lp_capital',$12)`,
    [i.receivable, i.fund, GROUP, i.vehicle, i.payable, i.capA, i.lpA, i.capB,
      "Partners' capital — LP A", i.lpB, i.capGp, i.gp])
}

/**
 * A draft capital-call issuance exactly as `issueCapitalCall` prepares it: Dr 1300 per partner,
 * Cr that partner's own capital account, posting tagged with the partner.
 */
export async function prepareCallEntry(db, perLp, { entryDate = '2026-03-31', entryId = null } = {}) {
  const i = IDS
  const { rows } = await db.query(
    `insert into journal_entries(id, fund_id, portfolio_group, vehicle_id, entry_date, memo, source_type, status, created_by)
     values (coalesce($1::uuid, gen_random_uuid()), $2, $3, $4, $5, 'Capital call', 'capital_call', 'draft', $6) returning id`,
    [entryId, i.fund, GROUP, i.vehicle, entryDate, i.user])
  const id = rows[0].id
  for (const [lpEntityId, amount] of Object.entries(perLp)) {
    const capital = capitalAccountFor(lpEntityId)
    await db.query(
      `insert into journal_postings(fund_id, portfolio_group, vehicle_id, journal_entry_id, account_id, amount, lp_entity_id)
       values ($1,$2,$3,$4,$5,$6,$7), ($1,$2,$3,$4,$8,$9,$7)`,
      [i.fund, GROUP, i.vehicle, id, i.receivable, amount, lpEntityId, capital, -amount])
  }
  return id
}

/** A draft distribution declaration: Dr the partner's capital, Cr 2300. */
export async function prepareDistributionEntry(db, perPartner, { entryDate = '2026-03-31', sourceType = 'distribution' } = {}) {
  const i = IDS
  const { rows } = await db.query(
    `insert into journal_entries(fund_id, portfolio_group, vehicle_id, entry_date, memo, source_type, status, created_by)
     values ($1,$2,$3,$4,'Distribution',$5,'draft',$6) returning id`,
    [i.fund, GROUP, i.vehicle, entryDate, sourceType, i.user])
  const id = rows[0].id
  for (const [lpEntityId, amount] of Object.entries(perPartner)) {
    const capital = capitalAccountFor(lpEntityId)
    await db.query(
      `insert into journal_postings(fund_id, portfolio_group, vehicle_id, journal_entry_id, account_id, amount, lp_entity_id)
       values ($1,$2,$3,$4,$5,$6,$7), ($1,$2,$3,$4,$8,$9,$7)`,
      [i.fund, GROUP, i.vehicle, id, capital, amount, lpEntityId, i.payable, -amount])
  }
  return id
}

export function capitalAccountFor(lpEntityId) {
  if (lpEntityId === IDS.lpA) return IDS.capA
  if (lpEntityId === IDS.lpB) return IDS.capB
  if (lpEntityId === IDS.gp) return IDS.capGp
  throw new Error(`No fixture capital account for ${lpEntityId}`)
}

/** Register rows in the 'draft' state the services create before publication. */
export async function draftCall(db, entryId, { callDate = '2026-03-31' } = {}) {
  const i = IDS
  const { rows } = await db.query(
    `insert into capital_calls(fund_id, vehicle_id, call_date, scope, status, journal_entry_id, created_by)
     values ($1,$2,$3,'fund_wide','draft',$4,$5) returning id`,
    [i.fund, i.vehicle, callDate, entryId, i.user])
  return rows[0].id
}

/**
 * A draft opening entry as the opening-balances route prepares it: each partner's opening balance
 * credited to their own capital account, the total debited to cash.
 */
export async function prepareOpeningEntry(db, perLp, { entryDate = '2026-03-31' } = {}) {
  const i = IDS
  const { rows } = await db.query(
    `insert into journal_entries(fund_id, portfolio_group, vehicle_id, entry_date, memo, source_type, source_ref, status, created_by)
     values ($1,$2,$3,$4,'Opening balances','opening_balance','partner-opening','draft',$5) returning id`,
    [i.fund, GROUP, i.vehicle, entryDate, i.user])
  const id = rows[0].id
  const { rows: [cash] } = await db.query(
    `insert into chart_of_accounts(fund_id, portfolio_group, vehicle_id, code, name, type, subtype)
     values ($1,$2,$3,'1000','Cash','asset','cash')
     on conflict (fund_id, portfolio_group, code) do update set name = excluded.name returning id`,
    [i.fund, GROUP, i.vehicle])
  // EVERY POSTING IN ONE STATEMENT. `journal_postings_must_balance` is a deferred constraint
  // trigger, so it fires at commit — and each statement here autocommits. Inserting the partner
  // credits and the cash debit separately would leave the entry unbalanced at a commit boundary
  // and the trigger would (correctly) refuse it.
  const entries = Object.entries(perLp)
  const total = entries.reduce((sum, [, amount]) => sum + Number(amount), 0)
  const rowsSql = entries.map((_, n) => `($1,$2,$3,$4,$${n * 3 + 5},$${n * 3 + 6},$${n * 3 + 7})`)
  const params = entries.flatMap(([lpEntityId, amount]) => [capitalAccountFor(lpEntityId), -Number(amount), lpEntityId])
  await db.query(
    `insert into journal_postings(fund_id, portfolio_group, vehicle_id, journal_entry_id, account_id, amount, lp_entity_id)
     values ${rowsSql.join(', ')}, ($1,$2,$3,$4,$${entries.length * 3 + 5},$${entries.length * 3 + 6},null)`,
    [i.fund, GROUP, i.vehicle, id, ...params, cash.id, total])
  return id
}

/** A dated reported observation for one partner. */
export async function reportedPosition(db, lpEntityId, asOfDate, { nav = null, calledCapital = null, distributions = null, commitment = null } = {}) {
  const i = IDS
  const { rows } = await db.query(
    `insert into lp_positions(fund_id, vehicle_id, lp_entity_id, as_of_date, commitment, called_capital, distributions, nav)
     values ($1,$2,$3,$4,$5,$6,$7,$8)
     on conflict (fund_id, vehicle_id, lp_entity_id, as_of_date)
       do update set nav = excluded.nav, called_capital = excluded.called_capital,
                     distributions = excluded.distributions, commitment = excluded.commitment
     returning id`,
    [i.fund, i.vehicle, lpEntityId, asOfDate, commitment, calledCapital, distributions, nav])
  return rows[0].id
}

export async function draftDistribution(db, entryId, carryEntryId = null, { date = '2026-03-31' } = {}) {
  const i = IDS
  const { rows } = await db.query(
    `insert into distributions(fund_id, vehicle_id, distribution_date, scope, status, journal_entry_id, carry_journal_entry_id, created_by)
     values ($1,$2,$3,'fund_wide','draft',$4,$5,$6) returning id`,
    [i.fund, i.vehicle, date, entryId ?? carryEntryId, carryEntryId, i.user])
  return rows[0].id
}

/** `assert.rejects` with a readable label, for both backends' error shapes. */
export async function rejects(label, fn, pattern) {
  let error = null
  try { await fn() } catch (e) { error = e }
  if (!error) throw new Error(`${label}: expected a refusal, the statement succeeded`)
  const message = String(error.message ?? error)
  if (pattern && !pattern.test(message)) {
    throw new Error(`${label}: refused for the wrong reason — ${message}`)
  }
  return message
}
