// Executes the unified-accounting migrations against an isolated PostgreSQL schema and checks
// what the SQL — not the TypeScript — is responsible for.
//
//   PGlite (single session, correctness only):
//     PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js node scripts/check-unified-accounting-migrations.mjs
//   Real server (also gives real lock behaviour to the companion concurrency script):
//     PG_MODULE=/path/to/pg/lib/index.js PGHOST=/tmp/sock PGPORT=55432 PGUSER=postgres \
//       PGDATABASE=unified_check node scripts/check-unified-accounting-migrations.mjs
//
// The fixture is a faithful subset, not the full Supabase schema — see the fixture module.
// Concurrency lives in scripts/check-unified-accounting-concurrency.mjs: one PGlite instance
// cannot demonstrate row locks between transactions.

import assert from 'node:assert/strict'
import {
  IDS, GROUP, applySchema, seedEntity, prepareCallEntry, prepareDistributionEntry,
  draftCall, draftDistribution, migrationSql, RETIREMENT_MIGRATION, rejects,
} from './unified-accounting-sql-fixture.mjs'

async function openDb() {
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

const db = await openDb()
const i = IDS
const one = async (sql, params) => (await db.query(sql, params)).rows[0]
const count = async (sql, params) => Number((await one(sql, params)).n)

/**
 * Run statements with the connection's role switched, so a REVOKE is exercised rather than
 * merely inspected: the connection owner is a superuser and bypasses every grant.
 */
async function asRole(role, fn) {
  await db.query('begin')
  try {
    await db.query(`set local role ${role}`)
    return await fn((sql, params) => db.query(sql, params))
  } finally {
    await db.query('rollback')
  }
}

await applySchema(db)
await seedEntity(db)

// ---------------------------------------------------------------------------
// 1. Frozen reports: created once, nulls preserved, no cross-tenant rows, no empty shell.
// ---------------------------------------------------------------------------
const reportRows = JSON.stringify([{ entity_id: i.lpA, portfolio_group: GROUP, commitment: 100, paid_in_capital: 40, nav: null }])
const freeze = (rows = reportRows, fund = i.fund) =>
  db.query("select freeze_live_report($1,'Q1 report','2026-03-31',null,null,$2::jsonb) r", [fund, rows])

assert.equal((await freeze()).rows[0].r.created, true, 'first freeze creates the snapshot')
assert.equal((await freeze()).rows[0].r.created, false, 'a repeated freeze does not rewrite a published report')
assert.equal((await one('select nav from lp_investments')).nav, null, 'an unknown NAV stays unknown, not zero')
await rejects('foreign entity in a frozen report', () => freeze(JSON.stringify([{ entity_id: i.foreignLp }])), /outside this fund/)
assert.equal(await count("select count(*)::int n from lp_snapshots where name = 'Q1 report'"), 1,
  'the refused report left no empty shareable shell')
assert.equal((await one("select reporting_definition from lp_snapshots where name = 'Q1 report'")).reporting_definition, 'capital-v1')

// ---------------------------------------------------------------------------
// 2. A QuickBooks transaction cannot be imported into the same book twice.
// ---------------------------------------------------------------------------
const qbEntry = async ref => db.query(
  `insert into journal_entries(fund_id, portfolio_group, vehicle_id, entry_date, source_ref, status)
   values ($1,$2,$3,'2026-02-01',$4,'draft') returning id`, [i.fund, GROUP, i.vehicle, ref])
await qbEntry('qb:one')
await rejects('duplicate QuickBooks import', () => qbEntry('qb:one'), /already been imported/)
await qbEntry('qb:two')

// ---------------------------------------------------------------------------
// 3. complete_capital_operation — the transactional publication wrapper.
// ---------------------------------------------------------------------------
const complete = (kind, registerId, entryIds, lines, fund = i.fund, vehicle = i.vehicle) =>
  db.query('select complete_capital_operation($1,$2,$3,$4,$5::uuid[],$6::jsonb)',
    [fund, vehicle, kind, registerId, entryIds, JSON.stringify(lines)])

// 3a. Recipient amounts must match the journal's capital postings, per partner.
{
  const entryId = await prepareCallEntry(db, { [i.lpA]: 60, [i.lpB]: 40 })
  const callId = await draftCall(db, entryId)
  await rejects('a recipient the journal does not pay',
    () => complete('call', callId, [entryId], [{ lpEntityId: i.lpA, amount: 60 }]),
    /do not match journal capital/)
  await rejects('an amount the journal does not pay',
    () => complete('call', callId, [entryId], [{ lpEntityId: i.lpA, amount: 60 }, { lpEntityId: i.lpB, amount: 41 }]),
    /do not match journal capital/)
  await rejects('a partner the journal pays but the request omits',
    () => complete('call', callId, [entryId], [{ lpEntityId: i.lpA, amount: 100 }]),
    /do not match journal capital/)

  // A rejected publication leaves neither lines nor a posted entry behind.
  assert.equal(await count('select count(*)::int n from capital_call_lines where call_id = $1', [callId]), 0,
    'a refused call wrote no recipient lines')
  assert.equal((await one('select status from journal_entries where id = $1', [entryId])).status, 'draft',
    'a refused call left its entry a draft')

  // The matching request publishes lines and entry together.
  await complete('call', callId, [entryId], [{ lpEntityId: i.lpA, amount: 60 }, { lpEntityId: i.lpB, amount: 40 }])
  assert.equal(await count('select count(*)::int n from capital_call_lines where call_id = $1', [callId]), 2)
  assert.equal((await one('select status from capital_calls where id = $1', [callId])).status, 'issued')
  assert.equal((await one('select status, posted_at is not null posted from journal_entries where id = $1', [entryId])).status, 'posted')

  // 3b. Repeated completion — the retry a lost HTTP response produces. Same economic result,
  // no second set of lines, no second posting.
  await complete('call', callId, [entryId], [{ lpEntityId: i.lpA, amount: 60 }, { lpEntityId: i.lpB, amount: 40 }])
  assert.equal(await count('select count(*)::int n from capital_call_lines where call_id = $1', [callId]), 2,
    'a completed retry added no duplicate recipient lines')
  assert.equal(await count('select count(*)::int n from journal_postings where journal_entry_id = $1', [entryId]), 4,
    'a completed retry added no duplicate postings')

  // 3c. A retry whose recipients differ from what was recorded is refused, not silently accepted.
  await rejects('a retry with different recipients',
    () => complete('call', callId, [entryId], [{ lpEntityId: i.lpA, amount: 100 }, { lpEntityId: i.lpB, amount: 40 }]),
    /do not match journal capital|differ from this request/)
}

// 3d. Input contract: no empty, duplicate, foreign, zero, negative, sub-cent or nonfinite lines.
{
  const entryId = await prepareCallEntry(db, { [i.lpA]: 50 })
  const callId = await draftCall(db, entryId)
  await rejects('no recipients', () => complete('call', callId, [entryId], []), /Recipients are required/)
  await rejects('duplicate recipient',
    () => complete('call', callId, [entryId], [{ lpEntityId: i.lpA, amount: 25 }, { lpEntityId: i.lpA, amount: 25 }]),
    /Duplicate recipient/)
  await rejects('a recipient from another fund',
    () => complete('call', callId, [entryId], [{ lpEntityId: i.foreignLp, amount: 50 }]),
    /must be valid for this fund/)
  for (const amount of [0, -50, 50.001, 'NaN', 'Infinity']) {
    await rejects(`amount ${amount}`,
      () => complete('call', callId, [entryId], [{ lpEntityId: i.lpA, amount }]),
      /must be valid for this fund/)
  }
  assert.equal((await one('select status from capital_calls where id = $1', [callId])).status, 'draft')
  assert.equal(await count('select count(*)::int n from capital_call_lines where call_id = $1', [callId]), 0)
}

// 3e. Scope: the entry set must be exactly the register's, and the register must be this entity's.
{
  const entryId = await prepareCallEntry(db, { [i.lpA]: 50 })
  const strayId = await prepareCallEntry(db, { [i.lpA]: 50 })
  const callId = await draftCall(db, entryId)
  const lines = [{ lpEntityId: i.lpA, amount: 50 }]
  await rejects('an entry the register does not reference', () => complete('call', callId, [strayId], lines), /scope or entries do not match/)
  await rejects('an extra entry alongside the register\'s', () => complete('call', callId, [entryId, strayId], lines), /scope or entries do not match/)
  await rejects('no entries at all', () => complete('call', callId, [], lines), /scope or entries do not match/)
  // Refused on the recipient check before the register is even looked up — the LP belongs to
  // this fund, not the caller's.
  await rejects('another tenant reaching this register',
    () => complete('call', callId, [entryId], lines, i.otherFund, i.otherVehicle), /must be valid for this fund/)
  // ...and with that tenant's own LP, on scope.
  await rejects('another tenant reaching this register with its own partner',
    () => complete('call', callId, [entryId], [{ lpEntityId: i.foreignLp, amount: 50 }], i.otherFund, i.otherVehicle),
    /scope or entries do not match/)
  await rejects('an unknown kind', () => complete('transfer', callId, [entryId], lines), /Unknown capital operation/)
  assert.equal((await one('select status from journal_entries where id = $1', [strayId])).status, 'draft',
    'the stray draft was not posted by any refused attempt')
}

// 3f. A failed finalisation rolls the inserted lines back with it. The closed-period trigger is
// the realistic failure: lines insert, then `finalize_capital_operation`'s UPDATE is refused.
{
  await db.query(
    `insert into fiscal_periods(fund_id, portfolio_group, vehicle_id, period_start, period_end, label, status)
     values ($1,$2,$3,'2026-01-01','2026-01-31','January 2026','open')`, [i.fund, GROUP, i.vehicle])
  const entryId = await prepareCallEntry(db, { [i.lpA]: 70 }, { entryDate: '2026-01-15' })
  const callId = await draftCall(db, entryId, { callDate: '2026-01-15' })
  await db.query("update fiscal_periods set status = 'closed' where fund_id = $1 and period_start = '2026-01-01'", [i.fund])
  await rejects('publishing into a closed period',
    () => complete('call', callId, [entryId], [{ lpEntityId: i.lpA, amount: 70 }]), /is closed/)
  assert.equal(await count('select count(*)::int n from capital_call_lines where call_id = $1', [callId]), 0,
    'the closed-period refusal rolled back the recipient lines the same statement had inserted')
  assert.equal((await one('select status from capital_calls where id = $1', [callId])).status, 'draft')
  assert.equal((await one('select status from journal_entries where id = $1', [entryId])).status, 'draft')
  await db.query("update fiscal_periods set status = 'open' where fund_id = $1 and period_start = '2026-01-01'", [i.fund])
  await complete('call', callId, [entryId], [{ lpEntityId: i.lpA, amount: 70 }])
  assert.equal((await one('select status from capital_calls where id = $1', [callId])).status, 'issued',
    'reopening the period let the same request through unchanged')
}

// 3g. An unbalanced entry cannot be published: the deferred balance trigger fires at commit,
// which is also what proves the publication is one transaction and not two.
{
  const entryId = await prepareCallEntry(db, { [i.lpA]: 50 })
  const callId = await draftCall(db, entryId)
  await db.query('update journal_postings set amount = 10 where journal_entry_id = $1 and account_id = $2', [entryId, i.receivable])
    .then(() => { throw new Error('expected the balance trigger to refuse an unbalanced edit') },
      e => assert.match(String(e.message), /out of balance/, 'the balance trigger refused the unbalancing edit'))
}

// 3h. Distributions: LP and carry lines, their roles, and the carry-only shape.
{
  const entryId = await prepareDistributionEntry(db, { [i.lpA]: 90 })
  const carryId = await prepareDistributionEntry(db, { [i.gp]: 10 }, { sourceType: 'carry_distribution' })
  const distId = await draftDistribution(db, entryId, carryId)
  const lines = [{ lpEntityId: i.lpA, amount: 90, role: 'lp' }, { lpEntityId: i.gp, amount: 10, role: 'carry' }]
  await rejects('a distribution recipient with no role',
    () => complete('distribution', distId, [entryId, carryId], [{ lpEntityId: i.lpA, amount: 90 }, { lpEntityId: i.gp, amount: 10 }]),
    /Invalid recipient role/)
  await rejects('a distribution recipient with an unknown role',
    () => complete('distribution', distId, [entryId, carryId], [{ lpEntityId: i.lpA, amount: 90, role: 'gp' }, { lpEntityId: i.gp, amount: 10, role: 'carry' }]),
    /Invalid recipient role/)
  await complete('distribution', distId, [entryId, carryId], lines)
  assert.equal((await one('select status from distributions where id = $1', [distId])).status, 'declared')
  assert.deepEqual(
    (await db.query('select role, amount::float amount from distribution_lines where distribution_id = $1 order by role', [distId])).rows,
    [{ role: 'carry', amount: 10 }, { role: 'lp', amount: 90 }])
  assert.equal(await count("select count(*)::int n from journal_entries where id in ($1,$2) and status = 'posted'", [entryId, carryId]), 2,
    'both the LP entry and the carry entry became visible together')
  await complete('distribution', distId, [entryId, carryId], lines)
  assert.equal(await count('select count(*)::int n from distribution_lines where distribution_id = $1', [distId]), 2,
    'a declared retry added no duplicate distribution lines')
}

// 3i. Carry-only: the service puts the same entry id in both register columns. Publication must
// still work and must not double-count the single entry.
{
  const carryId = await prepareDistributionEntry(db, { [i.gp]: 25 }, { sourceType: 'carry_distribution' })
  const distId = await draftDistribution(db, null, carryId)
  await complete('distribution', distId, [carryId], [{ lpEntityId: i.gp, amount: 25, role: 'carry' }])
  assert.equal((await one('select status from distributions where id = $1', [distId])).status, 'declared')
  assert.equal(await count('select count(*)::int n from distribution_lines where distribution_id = $1', [distId]), 1)
  assert.equal((await one('select status from journal_entries where id = $1', [carryId])).status, 'posted')
}

// ---------------------------------------------------------------------------
// 4. discard_unregistered_capital_drafts — cleanup that cannot reach a claimed draft.
// ---------------------------------------------------------------------------
const discard = (entryIds, fund = i.fund, vehicle = i.vehicle) =>
  db.query('select discard_unregistered_capital_drafts($1,$2,$3::uuid[])', [fund, vehicle, entryIds])
const exists = async id => (await count('select count(*)::int n from journal_entries where id = $1', [id])) === 1
{
  const orphan = await prepareCallEntry(db, { [i.lpA]: 15 })
  const claimed = await prepareCallEntry(db, { [i.lpA]: 15 })
  const claimedCall = await draftCall(db, claimed)
  const posted = await prepareCallEntry(db, { [i.lpA]: 15 })
  const postedCall = await draftCall(db, posted)
  await complete('call', postedCall, [posted], [{ lpEntityId: i.lpA, amount: 15 }])
  const { rows: [{ id: unrelated }] } = await db.query(
    `insert into journal_entries(fund_id, portfolio_group, vehicle_id, entry_date, source_type, status)
     values ($1,$2,$3,'2026-03-31','bank_import','draft') returning id`, [i.fund, GROUP, i.vehicle])

  await discard([orphan, claimed, posted, unrelated])
  assert.equal(await exists(orphan), false, 'the unregistered capital draft was discarded')
  assert.equal(await exists(claimed), true, 'a draft a register already points at is protected')
  assert.equal(await exists(posted), true, 'a posted entry is never discarded')
  assert.equal(await exists(unrelated), true, 'an unrelated draft of another source type is untouched')
  assert.equal((await one('select status from capital_calls where id = $1', [claimedCall])).status, 'draft')

  // Another tenant's request reaches nothing.
  const foreignTarget = await prepareCallEntry(db, { [i.lpA]: 15 })
  await discard([foreignTarget], i.otherFund, i.otherVehicle)
  assert.equal(await exists(foreignTarget), true, 'cleanup scoped to another entity discarded nothing here')
  await discard([foreignTarget])
  assert.equal(await exists(foreignTarget), false)

  // A carry draft left behind when the register write failed is cleanable by source type.
  const carryOrphan = await prepareDistributionEntry(db, { [i.gp]: 5 }, { sourceType: 'carry_distribution' })
  await discard([carryOrphan])
  assert.equal(await exists(carryOrphan), false, 'a carry_distribution draft is a capital draft for cleanup')
}

// ---------------------------------------------------------------------------
// 5. finalize_capital_operation directly: a register with no recipients cannot publish.
// ---------------------------------------------------------------------------
{
  const entryId = await prepareCallEntry(db, { [i.lpA]: 30 })
  const callId = await draftCall(db, entryId)
  await rejects('finalising a call with no recipient lines',
    () => db.query("select finalize_capital_operation($1,$2,'call',$3,array[$4::uuid])", [i.fund, i.vehicle, callId, entryId]),
    /no recipients/)
  assert.equal((await one('select status from journal_entries where id = $1', [entryId])).status, 'draft')
}

// ---------------------------------------------------------------------------
// 6. Request keys: one key publishes one register per entity.
// ---------------------------------------------------------------------------
{
  const mk = (key, fund = i.fund, vehicle = i.vehicle) => db.query(
    `insert into capital_calls(fund_id, vehicle_id, call_date, scope, status, request_key) values ($1,$2,'2026-04-01','fund_wide','draft',$3)`,
    [fund, vehicle, key])
  await mk('req-1')
  await rejects('a second register under one request key', () => mk('req-1'), /capital_call_request_once|duplicate key/)
  await mk('req-1', i.otherFund, i.otherVehicle)
  await mk(null); await mk(null) // unkeyed legacy writes are unaffected
  const mkd = key => db.query(
    `insert into distributions(fund_id, vehicle_id, distribution_date, scope, status, request_key) values ($1,$2,'2026-04-01','fund_wide','draft',$3)`,
    [i.fund, i.vehicle, key])
  await mkd('req-2')
  await rejects('a second distribution under one request key', () => mkd('req-2'), /distribution_request_once|duplicate key/)
}

// ---------------------------------------------------------------------------
// 7. Settlement review: explicit matching, partial allocation, no double allocation.
// ---------------------------------------------------------------------------
{
  const entryId = await prepareCallEntry(db, { [i.lpA]: 100, [i.lpB]: 100 }, { entryDate: '2026-05-01' })
  const callId = await draftCall(db, entryId, { callDate: '2026-05-01' })
  await complete('call', callId, [entryId], [{ lpEntityId: i.lpA, amount: 100 }, { lpEntityId: i.lpB, amount: 100 }])
  const lineA = (await one('select id from capital_call_lines where call_id = $1 and lp_entity_id = $2', [callId, i.lpA])).id
  const lineB = (await one('select id from capital_call_lines where call_id = $1 and lp_entity_id = $2', [callId, i.lpB])).id
  await db.query("update capital_call_lines set settled_amount = 80, settled_on = '2026-05-10' where id = $1", [lineA])
  await db.query("update capital_call_lines set settled_amount = 80, settled_on = '2026-05-10' where id = $1", [lineB])

  // A posted receipt clearing LP A's receivable: Dr cash / Cr 1300, tagged to LP A.
  const { rows: [{ id: wire }] } = await db.query(
    `insert into journal_entries(fund_id, portfolio_group, vehicle_id, entry_date, source_type, status, posted_at)
     values ($1,$2,$3,'2026-05-10','contribution_funding','posted',now()) returning id`, [i.fund, GROUP, i.vehicle])
  const { rows: [{ id: cash }] } = await db.query(
    `insert into chart_of_accounts(fund_id, portfolio_group, vehicle_id, code, name, type, subtype)
     values ($1,$2,$3,'1000','Cash','asset','cash') returning id`, [i.fund, GROUP, i.vehicle])
  await db.query(
    `insert into journal_postings(fund_id, portfolio_group, vehicle_id, journal_entry_id, account_id, amount, lp_entity_id)
     values ($1,$2,$3,$4,$5,80,null), ($1,$2,$3,$4,$6,-80,$7)`,
    [i.fund, GROUP, i.vehicle, wire, cash, i.receivable, i.lpA])

  const review = (lineId, links, separate = false, fund = i.fund, vehicle = i.vehicle) =>
    db.query("select review_capital_settlement($1,$2,'call',$3,$4::jsonb,$5,$6)",
      [fund, vehicle, lineId, JSON.stringify(links), separate, i.user])

  await review(lineA, [{ entryId: wire, amount: 80 }])
  await review(lineA, [{ entryId: wire, amount: 80 }]) // retry: same decision, new audit row
  assert.equal(await count('select count(*)::int n from capital_settlement_reviews'), 1)
  assert.equal(await count('select count(*)::int n from capital_settlement_review_history'), 2,
    'every decision, including an identical retry, is appended to history')

  await rejects('linking more than the payment itself', () => review(lineA, [{ entryId: wire, amount: 90 }]), /This payment is only 80.00/)
  await rejects('linking part without confirming the remainder', () => review(lineA, [{ entryId: wire, amount: 40 }]), /full recorded amount/)
  await rejects('linking a payment tagged to a different partner',
    () => review(lineB, [{ entryId: wire, amount: 80 }]), /posted payment for this partner/)

  // A second call line for the SAME partner is where over-allocation is actually possible: one
  // 80 wire cannot settle two 80 obligations.
  const secondEntry = await prepareCallEntry(db, { [i.lpA]: 80 }, { entryDate: '2026-05-02' })
  const secondCall = await draftCall(db, secondEntry, { callDate: '2026-05-02' })
  await complete('call', secondCall, [secondEntry], [{ lpEntityId: i.lpA, amount: 80 }])
  const lineA2 = (await one('select id from capital_call_lines where call_id = $1', [secondCall])).id
  await db.query("update capital_call_lines set settled_amount = 80, settled_on = '2026-05-12' where id = $1", [lineA2])
  await rejects('allocating a wire already matched to another line of the same partner',
    () => review(lineA2, [{ entryId: wire, amount: 80 }]), /still unallocated/)

  // Releasing part of it frees exactly that part, and no more.
  await review(lineA, [{ entryId: wire, amount: 40 }], true)
  await review(lineA2, [{ entryId: wire, amount: 40 }], true)
  await rejects('a third claim on the fully allocated wire',
    () => review(lineA2, [{ entryId: wire, amount: 41 }], true), /still unallocated/)
  await rejects('a duplicated link in one request',
    () => review(lineA, [{ entryId: wire, amount: 40 }, { entryId: wire, amount: 40 }]), /Duplicate payment link/)
  await rejects('a sub-cent allocation', () => review(lineA, [{ entryId: wire, amount: 0.001 }], true), /positive cent amount/)
  await rejects('another tenant reviewing this line', () => review(lineA, [{ entryId: wire, amount: 80 }], false, i.otherFund, i.otherVehicle), /No recorded payment/)
  await rejects('a line with no recorded manual payment', () => review(lineB, []), /full recorded amount|No recorded payment/)

  // A refused review changes nothing: the stored decision is exactly what it was.
  const before = await one('select manual_amount::float manual_amount, links, separate_remainder from capital_settlement_reviews where line_id = $1', [lineA])
  await rejects('a refused edit of an existing review',
    () => review(lineA, [{ entryId: wire, amount: 999 }]), /still unallocated|This payment is only/)
  assert.deepEqual(
    await one('select manual_amount::float manual_amount, links, separate_remainder from capital_settlement_reviews where line_id = $1', [lineA]),
    before, 'the refused edit left the previous decision in place, so the reviewer can simply try again')

  // STALE ALLOCATIONS MUST NOT STRAND A PAYMENT. Removing a line's recorded payment makes its
  // review stale — and that line can no longer be re-reviewed to release its claim, so if a
  // stale claim still counted, nothing could ever match that wire again.
  await db.query('update capital_call_lines set settled_amount = null, settled_on = null where id = $1', [lineA])
  await rejects('re-reviewing a line whose recorded payment is gone', () => review(lineA, []), /No recorded payment/)
  await review(lineA2, [{ entryId: wire, amount: 80 }])
  assert.equal(
    (await one("select (links->0->>'amount')::float amount from capital_settlement_reviews where line_id = $1", [lineA2])).amount, 80,
    'the whole payment was available again once the other line stopped recording one')

  // Restoring the manual record makes that review count again, so the wire is not double-claimed.
  await db.query("update capital_call_lines set settled_amount = 80, settled_on = '2026-05-10' where id = $1", [lineA])
  await rejects('a revived manual record re-asserting its allocation',
    () => review(lineA, [{ entryId: wire, amount: 80 }]), /still unallocated/)

  // A confirmed separate remainder with no links at all is a valid decision.
  await review(lineB, [], true)
  assert.equal(await count('select count(*)::int n from capital_settlement_reviews'), 3)

  // The decision cannot rest on a payment that is no longer posted.
  await db.query("update journal_entries set status = 'draft' where id = $1", [wire])
  await rejects('a draft payment', () => review(lineA, [{ entryId: wire, amount: 80 }]), /posted payment/)
  await db.query("update journal_entries set status = 'posted' where id = $1", [wire])

  // History is append-only even for the server role. Checked AS service_role: the migration's
  // revoke is what carries this, and the connection owner is a superuser that bypasses grants.
  for (const [label, sql] of [
    ['rewriting audit history', `update capital_settlement_review_history set decision = '{}'::jsonb`],
    ['deleting audit history', 'delete from capital_settlement_review_history'],
    ['truncating audit history', 'truncate capital_settlement_review_history'],
  ]) {
    await rejects(label, () => asRole('service_role', c => c(sql)), /permission denied/)
  }
  assert.equal(await count('select count(*)::int n from capital_settlement_review_history') > 0, true,
    'the refused rewrites left the history intact')
  // ...while appending is exactly what it must still allow.
  await asRole('service_role', c => c(
    "select review_capital_settlement($1,$2,'call',$3,'[]'::jsonb,true,$4)", [i.fund, i.vehicle, lineB, i.user]))
}

// ---------------------------------------------------------------------------
// 8. Client roles reach none of this.
// ---------------------------------------------------------------------------
for (const table of ['capital_settlement_reviews', 'capital_settlement_review_history']) {
  for (const role of ['anon', 'authenticated']) {
    for (const privilege of ['select', 'insert', 'update', 'delete']) {
      assert.equal((await one('select has_table_privilege($1,$2,$3) allowed', [role, table, privilege])).allowed, false,
        `${role} must not ${privilege} ${table}`)
    }
  }
}
for (const fn of [
  'review_capital_settlement(uuid,uuid,text,uuid,jsonb,boolean,uuid)',
  'complete_capital_operation(uuid,uuid,text,uuid,uuid[],jsonb)',
  'discard_unregistered_capital_drafts(uuid,uuid,uuid[])',
  'finalize_capital_operation(uuid,uuid,text,uuid,uuid[])',
  'freeze_live_report(uuid,text,date,text,text,jsonb)',
]) {
  for (const role of ['anon', 'authenticated']) {
    assert.equal((await one('select has_function_privilege($1,$2,$3) allowed', [role, fn, 'execute'])).allowed, false,
      `${role} must not execute ${fn}`)
  }
  assert.equal((await one('select has_function_privilege($1,$2,$3) allowed', ['service_role', fn, 'execute'])).allowed, true,
    `service_role must execute ${fn}`)
}

// ---------------------------------------------------------------------------
// 9. Column retirement, last: it is a separate deployment step.
// ---------------------------------------------------------------------------
const registersBefore = await count(`select
  (select count(*) from capital_calls where status = 'issued')
  + (select count(*) from distributions where status = 'declared')
  + (select count(*) from capital_call_lines) + (select count(*) from distribution_lines)
  + (select count(*) from journal_postings) + (select count(*) from lp_investments) as n`)
await db.exec(migrationSql(RETIREMENT_MIGRATION))
assert.equal(await count(
  `select count(*)::int n from information_schema.columns
   where table_name = 'vehicle_accounting_settings' and column_name in ('capital_source','history_mode')`), 0)
assert.equal(registersBefore > 0 && await count(`select
  (select count(*) from capital_calls where status = 'issued')
  + (select count(*) from distributions where status = 'declared')
  + (select count(*) from capital_call_lines) + (select count(*) from distribution_lines)
  + (select count(*) from journal_postings) + (select count(*) from lp_investments) as n`), registersBefore,
  'retiring the mode columns changed no register, line, posting or reported LP figure')

console.log(`unified-accounting SQL checks passed on ${db.kind}:
  frozen reports (immutability, nulls, tenant refusal, no empty shell)
  QuickBooks duplicate refusal
  complete_capital_operation: recipient/journal agreement, retry idempotence, input contract,
    scope and tenant refusal, closed-period rollback of inserted lines, balance trigger,
    distribution roles, carry-only publication
  discard_unregistered_capital_drafts: orphan removal, claimed/posted/foreign protection
  finalize_capital_operation recipient requirement
  request-key uniqueness per entity
  settlement review: matching, partial allocation, double-allocation refusal, draft refusal,
    append-only history, tenant refusal, editing an existing review, refusals that change
    nothing, and stale allocations releasing their claim instead of stranding a payment
  client-role denial on tables and functions
  legacy column retirement`)
await db.close()
