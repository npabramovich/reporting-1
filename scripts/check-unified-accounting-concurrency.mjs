// Concurrency checks for the capital-operation and settlement SQL, against a REAL PostgreSQL
// server with real concurrent sessions. PGlite cannot stand in for this: one instance has one
// session, so it can demonstrate correctness but never a row lock between transactions.
//
//   PG_MODULE=/path/to/pg/lib/index.js PGHOST=/tmp/sock PGPORT=55432 PGUSER=postgres \
//     PGDATABASE=unified_concurrency node scripts/check-unified-accounting-concurrency.mjs
//
// What each case models, in the shape the services actually produce:
//   A. Two requests publish the same empty draft register at once.
//   B. Two requests race to create the register under one request key; the loser cleans up.
//   C. Two requests allocate the same recorded wire to two different lines at once.
//   D. Two different registers in one vehicle publish simultaneously without blocking.
// Each statement from the services arrives as its own transaction (PostgREST autocommits), which
// is why the cases below commit between steps rather than holding one long transaction.

import assert from 'node:assert/strict'
import {
  IDS, GROUP, applySchema, seedEntity, prepareCallEntry, draftCall, rejects,
} from './unified-accounting-sql-fixture.mjs'

if (!process.env.PG_MODULE) {
  console.error('PG_MODULE is required: these checks need concurrent sessions, which PGlite cannot provide.')
  process.exit(2)
}
const pg = await import(process.env.PG_MODULE)
const Client = pg.Client ?? pg.default.Client
const config = {
  host: process.env.PGHOST, port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER ?? 'postgres', database: process.env.PGDATABASE ?? 'postgres',
}
const sessions = []
async function session() {
  const client = new Client(config)
  await client.connect()
  sessions.push(client)
  return { query: (s, p) => client.query(s, p), exec: s => client.query(s), pid: () => client.processID }
}

const i = IDS
const admin = await session()
const one = async (sql, params) => (await admin.query(sql, params)).rows[0]
const count = async (sql, params) => Number((await one(sql, params)).n)

await applySchema(admin)
await seedEntity(admin)

const COMPLETE = 'select complete_capital_operation($1,$2,$3,$4,$5::uuid[],$6::jsonb)'
const completeArgs = (kind, registerId, entryIds, lines) =>
  [i.fund, i.vehicle, kind, registerId, entryIds, JSON.stringify(lines)]

/** Resolves once `pid` is waiting on a lock, or fails if it never does. */
async function waitUntilBlocked(pid, label) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const { blocked } = await one(
      `select exists (select 1 from pg_stat_activity
         where pid = $1 and wait_event_type = 'Lock' and state = 'active') blocked`, [pid])
    if (blocked) return
    await new Promise(r => setTimeout(r, 25))
  }
  throw new Error(`${label}: the second session never blocked on a lock — it was not serialized`)
}

// ---------------------------------------------------------------------------
// A. Two requests publish the same empty draft register at the same time.
// ---------------------------------------------------------------------------
{
  const entryId = await prepareCallEntry(admin, { [i.lpA]: 60, [i.lpB]: 40 })
  const callId = await draftCall(admin, entryId)
  const lines = [{ lpEntityId: i.lpA, amount: 60 }, { lpEntityId: i.lpB, amount: 40 }]

  const first = await session()
  const second = await session()
  await first.query('begin')
  await first.query(COMPLETE, completeArgs('call', callId, [entryId], lines))

  // The second request arrives before the first commits.
  await second.query('begin')
  const pending = second.query(COMPLETE, completeArgs('call', callId, [entryId], lines))
  let settled = false
  pending.then(() => { settled = true }, () => { settled = true })
  await waitUntilBlocked(second.pid(), 'concurrent publication of one draft register')
  assert.equal(settled, false, 'the second publication did not proceed past the register lock')

  // Nothing is visible to anyone else yet: the register and its lines publish together.
  assert.equal(await count('select count(*)::int n from capital_call_lines where call_id = $1', [callId]), 0,
    'an uncommitted publication exposed no recipient lines')
  assert.equal((await one('select status from capital_calls where id = $1', [callId])).status, 'draft')

  await first.query('commit')
  await pending // the loser resumes and agrees with what it finds
  await second.query('commit')

  assert.equal(await count('select count(*)::int n from capital_call_lines where call_id = $1', [callId]), 2,
    'two concurrent publications of one register produced one set of recipient lines')
  assert.equal(await count('select count(*)::int n from journal_postings where journal_entry_id = $1', [entryId]), 4,
    'the entry was posted once, with no duplicated postings')
  assert.equal((await one('select status from capital_calls where id = $1', [callId])).status, 'issued')
  assert.equal((await one('select status from journal_entries where id = $1', [entryId])).status, 'posted')
  assert.deepEqual(
    (await admin.query('select amount::float amount from capital_call_lines where call_id = $1 order by amount', [callId])).rows,
    [{ amount: 40 }, { amount: 60 }], 'each partner was recorded once, for the amount the journal pays them')
}

// ---------------------------------------------------------------------------
// B. Two requests race to create the register under one request key.
// ---------------------------------------------------------------------------
{
  const key = 'call-2026-06-01-a1b2c3'
  const insertRegister = (db, entryId) => db.query(
    `insert into capital_calls(fund_id, vehicle_id, call_date, scope, status, journal_entry_id, request_key)
     values ($1,$2,'2026-06-01','fund_wide','draft',$3,$4) returning id`,
    [i.fund, i.vehicle, entryId, key])

  // Each request prepares its own draft entry first — committed, as PostgREST would.
  const winnerEntry = await prepareCallEntry(admin, { [i.lpA]: 25 }, { entryDate: '2026-06-01' })
  const loserEntry = await prepareCallEntry(admin, { [i.lpA]: 25 }, { entryDate: '2026-06-01' })

  const winner = await session()
  const loser = await session()
  await winner.query('begin')
  const { rows: [{ id: callId }] } = await insertRegister(winner, winnerEntry)

  await loser.query('begin')
  const losing = insertRegister(loser, loserEntry)
  let losingSettled = false
  losing.then(() => { losingSettled = true }, () => { losingSettled = true })
  await waitUntilBlocked(loser.pid(), 'concurrent register creation under one request key')
  assert.equal(losingSettled, false, 'the second register creation waited on the unique index')

  await winner.query('commit')
  await rejects('a second register under one request key', () => losing, /capital_call_request_once|duplicate key/)
  await loser.query('rollback')

  // The loser's orphan draft is cleanable; the winner's claimed draft is not.
  await admin.query('select discard_unregistered_capital_drafts($1,$2,$3::uuid[])',
    [i.fund, i.vehicle, [loserEntry, winnerEntry]])
  assert.equal(await count('select count(*)::int n from journal_entries where id = $1', [loserEntry]), 0,
    'the losing request left no orphan draft behind')
  assert.equal(await count('select count(*)::int n from journal_entries where id = $1', [winnerEntry]), 1,
    'cleanup could not reach the winner\'s claimed draft')

  // A retry of the losing request reuses the winner's register rather than publishing a second one.
  const found = await one('select id, journal_entry_id from capital_calls where fund_id = $1 and vehicle_id = $2 and request_key = $3',
    [i.fund, i.vehicle, key])
  assert.equal(found.id, callId)
  assert.equal(found.journal_entry_id, winnerEntry)
  await admin.query(COMPLETE, completeArgs('call', callId, [winnerEntry], [{ lpEntityId: i.lpA, amount: 25 }]))
  assert.equal(await count('select count(*)::int n from capital_calls where fund_id = $1 and request_key = $2', [i.fund, key]), 1,
    'one request key published exactly one call')
  assert.equal(await count("select count(*)::int n from journal_entries where entry_date = '2026-06-01' and status = 'posted'"), 1,
    'one request key posted exactly one entry')
}

// ---------------------------------------------------------------------------
// C. Two requests allocate the same recorded wire at the same time.
// ---------------------------------------------------------------------------
{
  const entryId = await prepareCallEntry(admin, { [i.lpA]: 160 }, { entryDate: '2026-07-01' })
  const callId = await draftCall(admin, entryId, { callDate: '2026-07-01' })
  await admin.query(COMPLETE, completeArgs('call', callId, [entryId], [{ lpEntityId: i.lpA, amount: 160 }]))
  const firstLine = (await one('select id from capital_call_lines where call_id = $1', [callId])).id

  const secondEntry = await prepareCallEntry(admin, { [i.lpA]: 80 }, { entryDate: '2026-07-02' })
  const secondCall = await draftCall(admin, secondEntry, { callDate: '2026-07-02' })
  await admin.query(COMPLETE, completeArgs('call', secondCall, [secondEntry], [{ lpEntityId: i.lpA, amount: 80 }]))
  const otherLine = (await one('select id from capital_call_lines where call_id = $1', [secondCall])).id

  for (const line of [firstLine, otherLine]) {
    await admin.query("update capital_call_lines set settled_amount = 80, settled_on = '2026-07-10' where id = $1", [line])
  }

  // One posted receipt of 80 for this partner. It cannot settle both 80 obligations.
  const { rows: [{ id: cash }] } = await admin.query(
    `insert into chart_of_accounts(fund_id, portfolio_group, vehicle_id, code, name, type, subtype)
     values ($1,$2,$3,'1000','Cash','asset','cash') returning id`, [i.fund, GROUP, i.vehicle])
  const { rows: [{ id: wire }] } = await admin.query(
    `insert into journal_entries(fund_id, portfolio_group, vehicle_id, entry_date, source_type, status, posted_at)
     values ($1,$2,$3,'2026-07-10','contribution_funding','posted',now()) returning id`, [i.fund, GROUP, i.vehicle])
  await admin.query(
    `insert into journal_postings(fund_id, portfolio_group, vehicle_id, journal_entry_id, account_id, amount, lp_entity_id)
     values ($1,$2,$3,$4,$5,80,null), ($1,$2,$3,$4,$6,-80,$7)`,
    [i.fund, GROUP, i.vehicle, wire, cash, i.receivable, i.lpA])

  const review = (db, lineId) => db.query("select review_capital_settlement($1,$2,'call',$3,$4::jsonb,false,$5)",
    [i.fund, i.vehicle, lineId, JSON.stringify([{ entryId: wire, amount: 80 }]), i.user])

  const a = await session()
  const b = await session()
  await a.query('begin')
  await review(a, firstLine)

  await b.query('begin')
  const contending = review(b, otherLine)
  let contendingSettled = false
  contending.then(() => { contendingSettled = true }, () => { contendingSettled = true })
  await waitUntilBlocked(b.pid(), 'concurrent allocation of one recorded payment')
  assert.equal(contendingSettled, false, 'the advisory lock serialized the second allocation')

  await a.query('commit')
  await rejects('allocating a wire the other session just took',
    () => contending, /still unallocated/)
  await b.query('rollback')

  const allocated = await count(
    `select coalesce(sum((x->>'amount')::numeric), 0)::int n from capital_settlement_reviews r
     cross join lateral jsonb_array_elements(r.links) x where x->>'entryId' = $1`, [wire])
  assert.equal(allocated, 80, 'exactly one of the two concurrent allocations took the payment')
  assert.equal(await count('select count(*)::int n from capital_settlement_reviews'), 1)
}

// ---------------------------------------------------------------------------
// D. Two different registers in one vehicle publish at the same time.
// ---------------------------------------------------------------------------
// The functions lock in one order throughout — register row first, then its journal entries by
// id — so disjoint registers never contend and never deadlock. Any new RPC that touches both
// must take them in that same order.
{
  const entryOne = await prepareCallEntry(admin, { [i.lpA]: 11 }, { entryDate: '2026-08-01' })
  const callOne = await draftCall(admin, entryOne, { callDate: '2026-08-01' })
  const entryTwo = await prepareCallEntry(admin, { [i.lpB]: 22 }, { entryDate: '2026-08-01' })
  const callTwo = await draftCall(admin, entryTwo, { callDate: '2026-08-01' })

  const a = await session()
  const b = await session()
  await a.query('begin')
  await b.query('begin')
  await Promise.all([
    a.query(COMPLETE, completeArgs('call', callOne, [entryOne], [{ lpEntityId: i.lpA, amount: 11 }])),
    b.query(COMPLETE, completeArgs('call', callTwo, [entryTwo], [{ lpEntityId: i.lpB, amount: 22 }])),
  ])
  await Promise.all([a.query('commit'), b.query('commit')])
  assert.equal(await count("select count(*)::int n from capital_calls where call_date = '2026-08-01' and status = 'issued'"), 2,
    'two disjoint registers published concurrently without deadlocking')
  assert.equal(await count("select count(*)::int n from journal_entries where entry_date = '2026-08-01' and status = 'posted'"), 2)
}

console.log(`unified-accounting concurrency checks passed against a real PostgreSQL server:
  one draft register published by two concurrent requests → one set of lines, one posting, serialized on the register row
  one request key raced by two requests → one register, loser's draft cleaned up, retry reuses the winner
  one recorded payment claimed by two reviews → serialized on the advisory lock, exactly one allocation
  two disjoint registers published simultaneously → no contention, no deadlock`)
await Promise.all(sessions.map(c => c.end()))
