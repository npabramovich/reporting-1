import { describe, it, expect, vi, beforeEach } from 'vitest'
import { checkInvestmentMatch, rankBankCandidates, matchInvestmentToBank, postWithoutBankMatch } from './investment-bank-match'
import { postExistingEntryWithAllocation } from './continuous-allocation'

vi.mock('./vehicle-id', () => ({ vehicleIdByName: vi.fn(async () => 'veh-1') }))
vi.mock('./persist', () => ({ accountIdByCode: vi.fn(async () => new Map([['1000', 'cash']])) }))
vi.mock('./periods', () => ({ closedPeriodRanges: vi.fn(async () => []), dateInAnyClosedPeriod: vi.fn(() => false) }))
vi.mock('./continuous-allocation', () => ({ postExistingEntryWithAllocation: vi.fn(async () => ({ allocationEntryIds: [] })) }))

// ---- The rules, pure. -----------------------------------------------------------------------
const entry = { id: 'e1', status: 'draft', entry_date: '2026-03-01', source_ref: 'txn:t1' }
const bank = { id: 'b1', amount: -1000, txn_date: '2026-03-02', status: 'drafted', journal_entry_id: 'auto1', raw: {} }

describe('checkInvestmentMatch', () => {
  it('accepts a draft and an unmatched bank row of the same amount', () => {
    expect(checkInvestmentMatch({ entry, bank, cash: -1000, claimedBy: null })).toBeNull()
  })

  it('accepts a difference under a cent — rounding, not a different payment', () => {
    expect(checkInvestmentMatch({ entry, bank: { ...bank, amount: -999.996 }, cash: -1000, claimedBy: null })).toBeNull()
  })

  it('refuses an amount mismatch rather than guessing a partial match', () => {
    expect(checkInvestmentMatch({ entry, bank: { ...bank, amount: -990 }, cash: -1000, claimedBy: null }))
      .toMatch(/-990\.00.*-1,?000\.00/)
  })

  it('refuses the opposite direction — a deposit is not a purchase', () => {
    expect(checkInvestmentMatch({ entry, bank: { ...bank, amount: 1000 }, cash: -1000, claimedBy: null })).toBeTruthy()
  })

  it('refuses a bank row already reconciled to something else', () => {
    expect(checkInvestmentMatch({ entry, bank: { ...bank, status: 'reconciled' }, cash: -1000, claimedBy: null })).toMatch(/already/)
  })

  it('refuses a bank row whose entry is a posted one', () => {
    expect(checkInvestmentMatch({ entry, bank, cash: -1000, claimedBy: { status: 'posted', source_ref: null } })).toMatch(/already/)
  })

  it('refuses a bank row claimed by another derived entry', () => {
    expect(checkInvestmentMatch({ entry, bank, cash: -1000, claimedBy: { status: 'draft', source_ref: 'txn:t9' } })).toMatch(/already/)
  })

  it('refuses an entry that is not a draft', () => {
    expect(checkInvestmentMatch({ entry: { ...entry, status: 'posted' }, bank, cash: -1000, claimedBy: null })).toMatch(/posted/)
  })

  it('refuses a QuickBooks row still under review', () => {
    expect(checkInvestmentMatch({ entry, bank: { ...bank, raw: { quickbooksReview: true } }, cash: -1000, claimedBy: null })).toMatch(/QuickBooks/)
  })
})

describe('rankBankCandidates', () => {
  it('keeps only same-amount rows, nearest date first — suggested, never applied', () => {
    const ranked = rankBankCandidates(-1000, '2026-03-01', [
      { ...bank, id: 'far', txn_date: '2026-03-20' },
      { ...bank, id: 'near', txn_date: '2026-02-28' },
      { ...bank, id: 'wrong-amount', amount: -500 },
      { ...bank, id: 'taken', status: 'reconciled' },
    ])
    expect(ranked.map(r => r.id)).toEqual(['near', 'far'])
  })
})

// ---- The orchestration: a failed post leaves the bank row as it was. ------------------------
type Row = Record<string, any>
function fakeAdmin(tables: Record<string, Row[]>, failOn?: string) {
  const writes: { table: string; op: string; values?: any; filters: Record<string, any> }[] = []
  const from = (table: string) => {
    const f: Record<string, any> = {}
    let op = 'select'; let values: any
    const rows = () => (tables[table] ?? []).filter(r => Object.entries(f).every(([k, v]) =>
      k.startsWith('in:') ? v.includes(r[k.slice(3)]) : k.startsWith('neq:') ? r[k.slice(4)] !== v : r[k] === v))
    const exec = () => {
      const hit = rows()
      if (op === 'update') { hit.forEach(r => Object.assign(r, values)); writes.push({ table, op, values, filters: { ...f } }) }
      if (op === 'delete') { tables[table] = (tables[table] ?? []).filter(r => !hit.includes(r)); writes.push({ table, op, filters: { ...f } }) }
      return hit
    }
    const chain: any = {
      select: () => chain,
      update: (v: any) => { op = 'update'; values = v; return chain },
      delete: () => { op = 'delete'; return chain },
      eq: (k: string, v: any) => { f[k] = v; return chain },
      neq: (k: string, v: any) => { f[`neq:${k}`] = v; return chain },
      in: (k: string, v: any[]) => { f[`in:${k}`] = v; return chain },
      is: (k: string, v: any) => { f[k] = v; return chain },
      maybeSingle: async () => ({ data: exec()[0] ?? null, error: null }),
      then: (res: any) => failOn === `${table}:${op}`
        ? res({ data: null, error: { message: `${op} failed` } })
        : res({ data: exec(), error: null }),
    }
    return chain
  }
  return { admin: { from } as any, writes, tables }
}

function world() {
  return fakeAdmin({
    investment_transactions: [{ id: 't1', fund_id: 'f1', portfolio_group: 'Fund I' }],
    journal_entries: [
      { id: 'e1', fund_id: 'f1', vehicle_id: 'veh-1', book: 'actual', status: 'draft', entry_date: '2026-03-01', source_ref: 'txn:t1' },
      { id: 'auto1', fund_id: 'f1', vehicle_id: 'veh-1', book: 'actual', status: 'draft', entry_date: '2026-03-02', source_ref: null },
    ],
    journal_postings: [
      { journal_entry_id: 'e1', fund_id: 'f1', book: 'actual', account_id: 'cost', amount: 1000 },
      { journal_entry_id: 'e1', fund_id: 'f1', book: 'actual', account_id: 'cash', amount: -1000 },
    ],
    bank_transactions: [{ id: 'b1', fund_id: 'f1', vehicle_id: 'veh-1', amount: -1000, txn_date: '2026-03-02', status: 'drafted', journal_entry_id: 'auto1', raw: {} }],
  })
}

describe('matchInvestmentToBank', () => {
  beforeEach(() => { vi.mocked(postExistingEntryWithAllocation).mockClear() })

  it('posts the entry, reconciles the bank row to it, and retires the auto-draft', async () => {
    const w = world()
    const r = await matchInvestmentToBank(w.admin, 'f1', 'Fund I', 'u1', 't1', 'b1')
    expect(r).toEqual({ ok: true, entryId: 'e1' })
    expect(postExistingEntryWithAllocation).toHaveBeenCalledWith(w.admin, 'f1', 'Fund I', 'u1', 'e1')
    expect(w.tables.bank_transactions[0]).toMatchObject({ journal_entry_id: 'e1', status: 'reconciled' })
    expect(w.tables.journal_entries.find(e => e.id === 'auto1')).toBeUndefined()
  })

  it('leaves the bank row and its auto-draft as they were when the post fails', async () => {
    vi.mocked(postExistingEntryWithAllocation).mockResolvedValueOnce({ error: 'Period closed.' })
    const w = world()
    const r = await matchInvestmentToBank(w.admin, 'f1', 'Fund I', 'u1', 't1', 'b1')
    expect(r).toEqual({ error: 'Period closed.' })
    expect(w.tables.bank_transactions[0]).toMatchObject({ journal_entry_id: 'auto1', status: 'drafted' })
    expect(w.tables.journal_entries.find(e => e.id === 'auto1')).toBeDefined()
  })

  it('says so when the bank row\'s auto-draft could not be retired — it could be posted later and book the wire twice', async () => {
    const w = world()
    const failing = fakeAdmin(w.tables, 'journal_entries:delete')
    const r = await matchInvestmentToBank(failing.admin, 'f1', 'Fund I', 'u1', 't1', 'b1')
    expect(r).toMatchObject({ ok: true, entryId: 'e1', warning: expect.stringMatching(/auto1|draft/) })
  })

  it('refuses another fund\'s transaction', async () => {
    const w = world()
    const r = await matchInvestmentToBank(w.admin, 'f2', 'Fund I', 'u1', 't1', 'b1')
    expect(r).toEqual({ error: 'Transaction not found' })
    expect(w.writes).toEqual([])
  })

  it('refuses another fund\'s bank row', async () => {
    const w = world()
    w.tables.bank_transactions[0].fund_id = 'f2'
    const r = await matchInvestmentToBank(w.admin, 'f1', 'Fund I', 'u1', 't1', 'b1')
    expect(r).toEqual({ error: 'Bank transaction not found' })
    expect(w.writes).toEqual([])
  })

  it('refuses an amount mismatch and writes nothing', async () => {
    const w = world()
    w.tables.bank_transactions[0].amount = -900
    const r = await matchInvestmentToBank(w.admin, 'f1', 'Fund I', 'u1', 't1', 'b1')
    expect('error' in r).toBe(true)
    expect(w.writes).toEqual([])
    expect(postExistingEntryWithAllocation).not.toHaveBeenCalled()
  })
})

describe('postWithoutBankMatch', () => {
  beforeEach(() => { vi.mocked(postExistingEntryWithAllocation).mockClear() })

  it('refuses while a bank transaction of the same amount is open — that is the match, not a missing feed', async () => {
    const w = world()
    const r = await postWithoutBankMatch(w.admin, 'f1', 'Fund I', 'u1', 't1')
    expect(r).toMatchObject({ error: expect.stringMatching(/bank transaction of the same amount/) })
    expect(postExistingEntryWithAllocation).not.toHaveBeenCalled()
  })

  it('posts the draft and records who decided it had no bank match', async () => {
    const w = world()
    w.tables.bank_transactions[0].amount = -999
    const r = await postWithoutBankMatch(w.admin, 'f1', 'Fund I', 'u1', 't1')
    expect(r).toEqual({ ok: true, entryId: 'e1' })
    expect(postExistingEntryWithAllocation).toHaveBeenCalledWith(w.admin, 'f1', 'Fund I', 'u1', 'e1')
    expect(w.tables.journal_entries.find(e => e.id === 'e1')).toMatchObject({ bank_match_waived_by: 'u1' })
    expect(w.tables.bank_transactions[0]).toMatchObject({ journal_entry_id: 'auto1', status: 'drafted' })
  })

  it('records no waiver when the post fails', async () => {
    vi.mocked(postExistingEntryWithAllocation).mockResolvedValueOnce({ error: 'Period closed.' })
    const w = world()
    w.tables.bank_transactions = []
    expect(await postWithoutBankMatch(w.admin, 'f1', 'Fund I', 'u1', 't1')).toEqual({ error: 'Period closed.' })
    expect(w.tables.journal_entries.find(e => e.id === 'e1')?.bank_match_waived_by).toBeUndefined()
  })
})
