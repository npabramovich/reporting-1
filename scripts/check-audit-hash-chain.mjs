// scripts/check-audit-hash-chain.mjs
//
// The audit trail's hash chain and the close bundles table
// (supabase/migrations/20261016170000_close_bundles_and_audit_hash_chain.sql), against real SQL:
//
//   - rows recorded before the migration are chained in order by the backfill;
//   - every new row is chained by the trigger, multi-row inserts included, whatever the writer sends;
//   - verify_accounting_audit_chain passes an intact chain and names the first break in a tampered one;
//   - the TypeScript chain (packages/fund-engine/src/audit-chain.ts) computes the same canonical
//     text and the same hashes as the database, so a chain can be checked outside it;
//   - two sessions writing for the same fund at once still produce one unbroken chain (real server);
//   - close_bundles is service-role only and append-only.
//
// Run through `npm run sql:check:accounting` (a throwaway cluster), or against PGlite with
// PGLITE_MODULE set (the concurrency part is skipped there: one PGlite instance has one session).

import assert from 'node:assert/strict'
import { BASE_SCHEMA, IDS, migrationSql, rejects } from './unified-accounting-sql-fixture.mjs'
import { auditEventContent, auditRowHash, canonicalJson, verifyAuditChain } from '../packages/fund-engine/src/audit-chain.ts'

async function connect() {
  if (process.env.PG_MODULE) {
    const pg = await import(process.env.PG_MODULE)
    const Client = pg.Client ?? pg.default.Client
    const client = new Client({
      host: process.env.PGHOST, port: Number(process.env.PGPORT ?? 5432),
      user: process.env.PGUSER ?? 'postgres', database: process.env.PGDATABASE ?? 'postgres',
    })
    await client.connect()
    return { kind: 'postgres', query: (s, p) => client.query(s, p), exec: s => client.query(s), close: () => client.end() }
  }
  const { PGlite } = await import(process.env.PGLITE_MODULE ?? '@electric-sql/pglite')
  const db = new PGlite()
  return { kind: 'pglite', query: (s, p) => db.query(s, p), exec: s => db.exec(s), close: () => db.close() }
}

// The tables the audit migrations touch that the unified fixture leaves out.
const AUDIT_FIXTURE = `
create table public.tax_year_close_events (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references funds(id) on delete cascade,
  vehicle_id uuid references fund_vehicles(id) on delete cascade
);
`
const BEFORE = [
  '20261010200000_accounting_audit_events.sql',
  '20261011200002_audit_tables_append_only.sql',
  '20261012140000_audit_events_source.sql',
]
const UNDER_TEST = '20261016170000_close_bundles_and_audit_hash_chain.sql'

const db = await connect()
const i = IDS
let passed = 0
const check = async (label, fn) => { await fn(); passed++; console.log(`  ✓ ${label}`) }

const ROW_SQL = `select id::text, fund_id::text, vehicle_id::text, actor_id::text, action, subject_type, subject_id, reason,
  details, source, created_at::text as created_at, chain_seq::int as chain_seq, prev_hash, row_hash
  from accounting_audit_events where fund_id = $1 order by chain_seq`
const rowsOf = async fund => (await db.query(ROW_SQL, [fund])).rows
const verify = async fund => (await db.query('select * from verify_accounting_audit_chain($1)', [fund])).rows[0]
const insert = (fund, action, details = {}, extra = {}) => db.query(
  `insert into accounting_audit_events (fund_id, actor_id, action, subject_type, subject_id, details, source${extra.created_at ? ', created_at' : ''})
   values ($1, $2, $3, 'fiscal_period', 'p', $4::jsonb, 'web'${extra.created_at ? ', $5' : ''})`,
  extra.created_at ? [fund, i.user, action, JSON.stringify(details), extra.created_at] : [fund, i.user, action, JSON.stringify(details)])

try {
  await db.exec(BASE_SCHEMA)
  await db.exec(AUDIT_FIXTURE)
  for (const name of BEFORE) await db.exec(migrationSql(name))
  await db.query('insert into funds(id) values ($1), ($2)', [i.fund, i.otherFund])
  await db.query('insert into fund_vehicles(id, fund_id, name) values ($1, $2, $3)', [i.vehicle, i.fund, 'Fund I'])

  // History recorded before the chain existed — deliberately out of insertion order by time.
  await insert(i.fund, 'period.close', { periodEnd: '2026-01-31', amount: 1500.5 }, { created_at: '2026-02-01T10:00:00.000001Z' })
  await insert(i.fund, 'entry.void', { note: 'Ünïcode — "quoted" \\ back' }, { created_at: '2026-01-15T09:00:00Z' })
  await insert(i.otherFund, 'entry.post', { ids: [1, 2, 3] }, { created_at: '2026-01-20T09:00:00Z' })
  await insert(i.fund, 'close.approve', { nested: { b: 1, a: [true, null, 0.25] } }, { created_at: '2026-02-02T10:00:00Z' })

  await db.exec(migrationSql(UNDER_TEST))

  await check('the backfill chains existing rows per fund in the order they were recorded', async () => {
    const rows = await rowsOf(i.fund)
    assert.deepEqual(rows.map(r => [r.chain_seq, r.action]), [[1, 'entry.void'], [2, 'period.close'], [3, 'close.approve']])
    assert.equal(rows[0].prev_hash, '0'.repeat(64))
    assert.equal(rows[1].prev_hash, rows[0].row_hash)
    assert.deepEqual((await rowsOf(i.otherFund)).map(r => r.chain_seq), [1])
  })

  await check('new rows are chained by the trigger, whatever the writer sends for the chain columns', async () => {
    await db.query(`insert into accounting_audit_events (fund_id, action, subject_type, details, chain_seq, prev_hash, row_hash)
      values ($1, 'entry.post', 'journal_entry', '{"forged":true}', 99, 'x', 'y')`, [i.fund])
    const rows = await rowsOf(i.fund)
    const last = rows.at(-1)
    assert.equal(last.chain_seq, 4)
    assert.equal(last.prev_hash, rows[2].row_hash)
    assert.notEqual(last.row_hash, 'y')
  })

  await check('a multi-row insert chains each row after the one before it', async () => {
    await db.query(`insert into accounting_audit_events (fund_id, action, subject_type, details) values
      ($1, 'entries.bulk_post', 'journal_entry', '{"n":1}'), ($1, 'entries.bulk_post', 'journal_entry', '{"n":2}'),
      ($1, 'entries.bulk_post', 'journal_entry', '{"n":3}')`, [i.fund])
    const rows = await rowsOf(i.fund)
    assert.deepEqual(rows.map(r => r.chain_seq), [1, 2, 3, 4, 5, 6, 7])
    for (let k = 1; k < rows.length; k++) assert.equal(rows[k].prev_hash, rows[k - 1].row_hash)
  })

  await check('verify_accounting_audit_chain passes an intact chain and reports its head', async () => {
    const v = await verify(i.fund)
    const rows = await rowsOf(i.fund)
    assert.equal(v.ok, true)
    assert.equal(Number(v.checked), 7)
    assert.equal(Number(v.head_seq), 7)
    assert.equal(v.head_hash, rows.at(-1).row_hash)
    const empty = await verify('00000000-0000-0000-0000-0000000000ee')
    assert.equal(empty.ok, true)
    assert.equal(Number(empty.checked), 0)
  })

  await check('the TypeScript chain computes the same canonical text and hashes as the database', async () => {
    const samples = [
      { b: 1, a: { d: [3, { z: null, y: true }], c: 'x' } },
      { 'é': 1, z: 2, Z: 3, '😀': 4, '': 5 },
      { n: [1, 1.5, 0, -2, 100, 1e21, 0.000000125, 123456.789, 1234.5, 0.1] },
      { s: 'quote " back \\ nl \n tab \t ctl \u0001 euro € line sep' },
      [], {}, 'plain', 0, true, null,
    ]
    for (const v of samples) {
      const { rows: [{ c }] } = await db.query('select canonical_jsonb($1::jsonb) as c', [JSON.stringify(v)])
      assert.equal(canonicalJson(v), c, `canonical text of ${JSON.stringify(v)}`)
    }
    for (const fund of [i.fund, i.otherFund]) {
      const rows = await rowsOf(fund)
      for (const r of rows) {
        const { rows: [{ c }] } = await db.query('select accounting_audit_event_content(e) as c from accounting_audit_events e where id = $1', [r.id])
        assert.equal(auditEventContent(r), c, `content of row ${r.chain_seq}`)
        assert.equal(auditRowHash(r.prev_hash, c), r.row_hash, `hash of row ${r.chain_seq}`)
      }
      assert.equal(verifyAuditChain(rows).ok, true)
    }
  })

  await check('UPDATE and DELETE are still refused, and the hashes cannot be rewritten', async () => {
    await rejects('update details', () => db.query(`update accounting_audit_events set details = '{}' where fund_id = $1`, [i.fund]), /append-only/)
    await rejects('update hash', () => db.query(`update accounting_audit_events set row_hash = 'x' where fund_id = $1`, [i.fund]), /append-only/)
    await rejects('delete', () => db.query('delete from accounting_audit_events where fund_id = $1', [i.fund]), /append-only/)
  })

  await check('a row changed behind the trigger is found, at the row it was changed', async () => {
    // Only the table owner can do this, by switching the guard off — the attack the chain is for.
    await db.exec('alter table accounting_audit_events disable trigger accounting_audit_events_no_change')
    await db.query(`update accounting_audit_events set details = '{"periodEnd":"2026-01-31","amount":1}' where fund_id = $1 and chain_seq = 2`, [i.fund])
    await db.exec('alter table accounting_audit_events enable trigger accounting_audit_events_no_change')
    const v = await verify(i.fund)
    assert.equal(v.ok, false)
    assert.equal(Number(v.break_seq), 2)
    assert.match(v.problem, /content was changed/)
    assert.equal(Number(v.checked), 1)
    const ts = verifyAuditChain(await rowsOf(i.fund))
    assert.equal(ts.ok, false)
    assert.equal(ts.firstBreak.seq, 2)
    // The other fund's chain is its own and still holds.
    assert.equal((await verify(i.otherFund)).ok, true)
  })

  await check('a deleted row breaks the sequence', async () => {
    await insert(i.otherFund, 'entry.post', { n: 2 })
    await insert(i.otherFund, 'entry.post', { n: 3 })
    assert.equal((await verify(i.otherFund)).ok, true)
    await db.exec('alter table accounting_audit_events disable trigger accounting_audit_events_no_change')
    await db.query('delete from accounting_audit_events where fund_id = $1 and chain_seq = 2', [i.otherFund])
    await db.exec('alter table accounting_audit_events enable trigger accounting_audit_events_no_change')
    const v = await verify(i.otherFund)
    assert.equal(v.ok, false)
    assert.equal(Number(v.break_seq), 3)
    assert.match(v.problem, /expected sequence 2/)
  })

  if (db.kind === 'postgres' && process.env.PG_MODULE) {
    await check('two sessions writing for one fund at once still make one unbroken chain', async () => {
      const pg = await import(process.env.PG_MODULE)
      const Client = pg.Client ?? pg.default.Client
      const open = async () => { const c = new Client({ host: process.env.PGHOST, port: Number(process.env.PGPORT), user: process.env.PGUSER ?? 'postgres', database: process.env.PGDATABASE }); await c.connect(); return c }
      const a = await open(), b = await open()
      const fresh = '00000000-0000-0000-0000-0000000000fc'
      await db.query('insert into funds(id) values ($1)', [fresh])
      const sql = `insert into accounting_audit_events (fund_id, action, subject_type) values ($1, 'entry.post', 'journal_entry')`
      await a.query('begin')
      await a.query(sql, [fresh])
      await b.query('begin')
      const second = b.query(sql, [fresh]) // waits on a's advisory lock
      await new Promise(r => setTimeout(r, 200))
      await a.query(sql, [fresh])
      await a.query('commit')
      await second
      await b.query(sql, [fresh])
      await b.query('commit')
      await Promise.all([a.end(), b.end()])
      const rows = await rowsOf(fresh)
      assert.deepEqual(rows.map(r => r.chain_seq), [1, 2, 3, 4])
      assert.equal((await verify(fresh)).ok, true)
    })
  }

  await check('close_bundles: service role reads and inserts; nobody updates or deletes; anon and authenticated see nothing', async () => {
    await db.query(`insert into close_bundles (fund_id, vehicle_id, fiscal_period_id, period_start, period_end, bundle_sha256, engine_version,
      manifest_json, ledger_text, terms_json, statements_json) values ($1, $2, gen_random_uuid(), '2026-01-01', '2026-01-31', $3, '0.2.0', '{}', '', '{}', '{}')`,
      [i.fund, i.vehicle, 'a'.repeat(64)])
    await rejects('bad hash', () => db.query(`insert into close_bundles (fund_id, vehicle_id, fiscal_period_id, period_start, period_end, bundle_sha256, engine_version,
      manifest_json, ledger_text, terms_json, statements_json) values ($1, $2, gen_random_uuid(), '2026-01-01', '2026-01-31', 'nope', '0.2.0', '{}', '', '{}', '{}')`, [i.fund, i.vehicle]), /check/)
    await rejects('update', () => db.query(`update close_bundles set ledger_text = 'x'`), /append-only/)
    await rejects('delete', () => db.query('delete from close_bundles'), /append-only/)
    await rejects('truncate', () => db.query('truncate close_bundles'), /append-only/)
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`)
      await rejects(`${role} select`, () => db.query('select * from close_bundles'), /permission denied/)
      await rejects(`${role} verify`, () => db.query('select * from verify_accounting_audit_chain($1)', [i.fund]), /permission denied/)
      await db.exec('reset role')
    }
    await db.exec('set role service_role')
    assert.equal((await db.query('select count(*)::int as n from close_bundles')).rows[0].n, 1)
    await rejects('service_role update', () => db.query(`update close_bundles set ledger_text = 'x'`), /permission denied|append-only/)
    assert.equal(typeof (await verify(i.fund)).ok, 'boolean')
    await db.exec('reset role')
    // The fund cascade still clears both append-only tables.
    await db.query('delete from funds where id = $1', [i.fund])
    assert.equal((await db.query('select count(*)::int as n from close_bundles')).rows[0].n, 0)
    assert.equal((await db.query('select count(*)::int as n from accounting_audit_events where fund_id = $1', [i.fund])).rows[0].n, 0)
  })

  console.log(`\n${passed} audit-chain checks passed (${db.kind})`)
} catch (e) {
  console.error(e)
  process.exitCode = 1
} finally {
  await db.close()
}
