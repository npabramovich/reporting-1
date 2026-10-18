import { describe, it, expect } from 'vitest'
import { postPassThroughAdjustments, voidPriorPassThrough } from './k1-passthrough-run'

// A minimal stand-in for the Supabase client: enough of the query builder to answer the reads the
// run makes, recording every filter and write so the tests can say what was (and was not) touched.
// All names and figures are invented.

type Row = Record<string, any>

function fakeAdmin(tables: Record<string, Row[]>) {
  const writes: { table: string; op: string; payload?: any; filters: [string, string, any][] }[] = []
  const reads: { table: string; filters: [string, string, any][] }[] = []

  const field = (row: Row, key: string) => key in row ? row[key] : row.journal_entries?.[key]
  const matches = (row: Row, [op, key, v]: [string, string, any]) => {
    const x = field(row, key)
    if (op === 'eq') return x === v
    if (op === 'in') return (v as any[]).includes(x)
    if (op === 'like') return typeof x === 'string' && x.startsWith(String(v).replace(/%$/, ''))
    if (op === 'gte') return x >= v
    if (op === 'lte') return x <= v
    if (op === 'contains') return Array.isArray(x) && (v as any[]).every(e => x.includes(e))
    return true
  }

  const from = (table: string) => {
    const filters: [string, string, any][] = []
    let op: 'select' | 'update' | 'insert' = 'select'
    let payload: any
    const rows = () => (tables[table] ?? []).filter(r => filters.every(f => matches(r, f)))
    const result = () => {
      if (op === 'select') { reads.push({ table, filters: [...filters] }); return { data: rows(), error: null } }
      writes.push({ table, op, payload, filters: [...filters] })
      return { data: op === 'insert' ? [] : null, error: null }
    }
    const b: any = {
      select: () => b,
      update: (p: any) => { op = 'update'; payload = p; return b },
      insert: (p: any) => { op = 'insert'; payload = p; return b },
      eq: (k: string, v: any) => { filters.push(['eq', k, v]); return b },
      in: (k: string, v: any) => { filters.push(['in', k, v]); return b },
      like: (k: string, v: any) => { filters.push(['like', k, v]); return b },
      gte: (k: string, v: any) => { filters.push(['gte', k, v]); return b },
      lte: (k: string, v: any) => { filters.push(['lte', k, v]); return b },
      contains: (k: string, v: any) => { filters.push(['contains', k, v]); return b },
      order: () => b,
      limit: () => b,
      range: (from: number) => Promise.resolve(from === 0 ? result() : { data: [], error: null }),
      maybeSingle: () => { const r = result(); return Promise.resolve({ data: (r.data as any[] | null)?.[0] ?? null, error: null }) },
      then: (res: any, rej: any) => Promise.resolve(result()).then(res, rej),
    }
    return b
  }
  return { admin: { from } as any, writes, reads }
}

const AMOUNTS_ROW = {
  box5_interest: 1_000,
  box9a_net_long_term_gain: 10_000,
  box19a_distributions_cash: 8_000,
  capital_ending: 50_000,
  amounts_recorded_at: '2025-03-01T00:00:00Z',
}

function world(overrides: Partial<Record<string, Row[]>> = {}) {
  return {
    fund_vehicles: [{ id: 'veh-1', fund_id: 'fund-1', name: 'Acme Holdings', kind: 'individual' }],
    tax_year_closes: [],
    companies: [
      { id: 'co-north', fund_id: 'fund-1', name: 'Northwind Partners III', holding_type: 'fund', portfolio_group: ['Acme Holdings'] },
      { id: 'co-west', fund_id: 'fund-1', name: 'Westbrook Fund II', holding_type: 'fund', portfolio_group: ['Acme Holdings', 'Example Fund I'] },
      { id: 'co-east', fund_id: 'fund-1', name: 'Eastgate Capital IV', holding_type: 'fund', portfolio_group: ['Acme Holdings'] },
    ],
    received_k1s: [
      { fund_id: 'fund-1', vehicle_id: 'veh-1', company_id: 'co-north', tax_year: 2024, status: 'received', ...AMOUNTS_ROW },
      // Recorded without an entity, for a holding two entities share: ambiguous, so refused.
      { fund_id: 'fund-1', vehicle_id: null, company_id: 'co-west', tax_year: 2024, status: 'received', ...AMOUNTS_ROW },
      // Arrived, amounts not entered yet.
      { fund_id: 'fund-1', vehicle_id: 'veh-1', company_id: 'co-east', tax_year: 2024, status: 'received', amounts_recorded_at: null },
    ],
    chart_of_accounts: [
      { id: 'a-1100-n', code: '1100-co-north', name: 'Investment — Northwind', type: 'asset', subtype: 'investment', company_id: 'co-north', fund_id: 'fund-1', vehicle_id: 'veh-1' },
      { id: 'a-4000-n', code: '4000-co-north', name: 'Realized gain — Northwind', type: 'income', subtype: 'realized_gain', company_id: 'co-north', fund_id: 'fund-1', vehicle_id: 'veh-1' },
      { id: 'a-3000', code: '3000', name: "Owner's capital", type: 'equity', subtype: 'members_capital', company_id: null, fund_id: 'fund-1', vehicle_id: 'veh-1' },
      { id: 'a-3200', code: '3200', name: 'Bridge', type: 'equity', subtype: 'undistributed_earnings', company_id: null, fund_id: 'fund-1', vehicle_id: 'veh-1' },
    ],
    journal_postings: [
      // Cost of 100,000, then a distribution of 8,000 that retired 5,000 of cost and booked 3,000 of gain.
      { id: 'p1', journal_entry_id: 'e1', account_id: 'a-1100-n', amount: 100_000, book: 'actual', fund_id: 'fund-1', vehicle_id: 'veh-1', journal_entries: { entry_date: '2023-05-01', status: 'posted', book: 'actual', source_ref: 'txn:1' } },
      { id: 'p2', journal_entry_id: 'e2', account_id: 'a-1100-n', amount: -5_000, book: 'actual', fund_id: 'fund-1', vehicle_id: 'veh-1', journal_entries: { entry_date: '2024-06-30', status: 'posted', book: 'actual', source_ref: 'txn:2' } },
      { id: 'p3', journal_entry_id: 'e2', account_id: 'a-4000-n', amount: -3_000, book: 'actual', fund_id: 'fund-1', vehicle_id: 'veh-1', journal_entries: { entry_date: '2024-06-30', status: 'posted', book: 'actual', source_ref: 'txn:2' } },
      // A gain in another year is not this year's to reverse.
      { id: 'p4', journal_entry_id: 'e3', account_id: 'a-4000-n', amount: -999, book: 'actual', fund_id: 'fund-1', vehicle_id: 'veh-1', journal_entries: { entry_date: '2023-06-30', status: 'posted', book: 'actual', source_ref: 'txn:3' } },
      // A previous run's own entry: replaced, so not part of the basis before this run.
      { id: 'p5', journal_entry_id: 'e4', account_id: 'a-1100-n', amount: 77_777, book: 'tax', fund_id: 'fund-1', vehicle_id: 'veh-1', journal_entries: { entry_date: '2024-12-31', status: 'posted', book: 'tax', source_ref: 'tax-k1:2024:co-north' } },
      // A preparer's hand entry on the holding: flagged, never voided.
      { id: 'p6', journal_entry_id: 'e5', account_id: 'a-1100-n', amount: 10, book: 'tax', fund_id: 'fund-1', vehicle_id: 'veh-1', journal_entries: { entry_date: '2024-12-31', status: 'posted', book: 'tax', source_ref: null } },
    ],
    investment_transactions: [
      { fund_id: 'fund-1', company_id: 'co-north', transaction_type: 'proceeds', portfolio_group: 'Acme Holdings', proceeds_received: 8_000, transaction_date: '2024-06-30' },
    ],
    journal_entries: [
      { id: 'e4', fund_id: 'fund-1', vehicle_id: 'veh-1', book: 'tax', status: 'posted', source_ref: 'tax-k1:2024:co-north' },
      { id: 'e5', fund_id: 'fund-1', vehicle_id: 'veh-1', book: 'tax', status: 'posted', source_ref: null },
      { id: 'e6', fund_id: 'fund-1', vehicle_id: 'veh-1', book: 'tax', status: 'posted', source_ref: 'tax:2024' },
      { id: 'e7', fund_id: 'fund-1', vehicle_id: 'veh-1', book: 'tax', status: 'posted', source_ref: 'tax-k1:2023:co-north' },
    ],
    ...overrides,
  } as Record<string, Row[]>
}

describe('postPassThroughAdjustments — preview', () => {
  it('derives each recorded K-1 and writes nothing', async () => {
    const { admin, writes } = fakeAdmin(world())
    const res = await postPassThroughAdjustments(admin, 'fund-1', 'Acme Holdings', 'user-1', 2024, { preview: true })
    if ('error' in res) throw new Error(res.error)
    expect(writes).toEqual([])
    expect(res.entryIds).toEqual([])

    const north = res.holdings.find(h => h.companyId === 'co-north')!
    expect(north.skipped).toBeUndefined()
    expect(north.lines.map(l => [l.box, l.accountCode, l.reported])).toEqual([['5', '4610', 1_000], ['9a', '4640', 10_000]])
    // This year's book gain only.
    expect(north.bookRealizedGainReversed).toBe(3_000)
    expect(north.basisChange).toBe(11_000 - 3_000)
    // Cost 95,000 + the hand entry's 10, the previous run's entry excluded, + this run's 8,000.
    expect(north.basisTieOut.derived).toBe(103_010)
    expect(north.basisTieOut.reportedEndingCapital).toBe(50_000)
    expect(north.distributions).toEqual({ reported: 8_000, recorded: 8_000, difference: 0 })
    expect(north.handEntries).toBe(1)
    expect(north.warnings.some(w => /hand-authored/.test(w))).toBe(true)
  })

  it('refuses a K-1 recorded without an entity for a holding two entities share', async () => {
    const { admin } = fakeAdmin(world())
    const res = await postPassThroughAdjustments(admin, 'fund-1', 'Acme Holdings', 'user-1', 2024, { preview: true })
    if ('error' in res) throw new Error(res.error)
    expect(res.holdings.find(h => h.companyId === 'co-west')?.skipped).toMatch(/more than one entity/)
  })

  it('lists a K-1 that arrived without amounts as waiting, and posts nothing for it', async () => {
    const { admin } = fakeAdmin(world())
    const res = await postPassThroughAdjustments(admin, 'fund-1', 'Acme Holdings', 'user-1', 2024, { preview: true })
    if ('error' in res) throw new Error(res.error)
    expect(res.awaitingAmounts).toEqual([{ companyId: 'co-east', companyName: 'Eastgate Capital IV' }])
    expect(res.holdings.find(h => h.companyId === 'co-east')).toBeUndefined()
  })
})

describe('postPassThroughAdjustments — posting', () => {
  it('refuses a closed tax year before reading or voiding anything', async () => {
    const { admin, writes } = fakeAdmin(world({ tax_year_closes: [{ fund_id: 'fund-1', vehicle_id: 'veh-1', tax_year: 2024, status: 'closed' }] }))
    const res = await postPassThroughAdjustments(admin, 'fund-1', 'Acme Holdings', 'user-1', 2024)
    expect(res).toEqual({ error: expect.stringContaining('Tax year 2024 is closed') })
    expect(writes).toEqual([])
  })
})

describe('voidPriorPassThrough', () => {
  it('voids only this year’s pass-through entries — never a hand entry, the other run, or another year', async () => {
    const { admin, writes, reads } = fakeAdmin(world())
    const n = await voidPriorPassThrough(admin, 'fund-1', 'veh-1', 2024)
    expect(n).toBe(1)
    const read = reads.find(r => r.table === 'journal_entries')!
    expect(read.filters).toEqual(expect.arrayContaining([['eq', 'book', 'tax'], ['eq', 'vehicle_id', 'veh-1'], ['like', 'source_ref', 'tax-k1:2024:%'], ['eq', 'status', 'posted']]))
    expect(writes).toEqual([{ table: 'journal_entries', op: 'update', payload: { status: 'void' }, filters: [['in', 'id', ['e4']]] }])
  })
})
