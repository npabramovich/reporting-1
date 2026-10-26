import { describe, expect, it } from 'vitest'
import {
  buildFacilityEntry,
  facilityBalance,
  facilityEntryRef,
  linkedAmount,
  matchRepayments,
  type FacilityEvent,
} from './credit-facility-core'

let n = 0
const ev = (type: FacilityEvent['type'], date: string, amount: number, extra: Partial<FacilityEvent> = {}): FacilityEvent => ({
  id: `e${++n}`, facilityId: 'f1', type, date, amount,
  purpose: type === 'draw' ? 'investment' : null, callId: null, journalEntryId: `j${n}`, origin: 'posted', memo: null, live: true,
  ...extra,
})

describe('facilityBalance', () => {
  it('nets draws against repayments through the date, ignoring voided rows', () => {
    const rows = [
      ev('draw', '2026-01-10', 1_000_000),
      ev('draw', '2026-02-10', 500_000),
      ev('repayment', '2026-03-01', 1_000_000),
      ev('interest', '2026-03-31', 12_500),
      ev('fee', '2026-03-31', 1_000),
      ev('draw', '2026-04-05', 250_000, { live: false }),
    ]
    expect(facilityBalance(rows)).toEqual({ drawn: 1_500_000, repaid: 1_000_000, outstanding: 500_000, interest: 12_500, fees: 1_000 })
    expect(facilityBalance(rows, '2026-02-28').outstanding).toBe(1_500_000)
  })
})

describe('matchRepayments', () => {
  it('retires the oldest draws first and types each repayment by them', () => {
    const rows = [
      ev('draw', '2026-01-10', 600, { purpose: 'investment' }),
      ev('draw', '2026-01-20', 400, { purpose: 'management_fee' }),
      ev('repayment', '2026-02-01', 800),
      ev('draw', '2026-02-15', 300, { purpose: 'working_capital' }),
    ]
    const m = matchRepayments(rows)
    expect(m.repayments).toEqual([
      { repaymentId: rows[2].id, date: '2026-02-01', purpose: 'investment', amount: 600 },
      { repaymentId: rows[2].id, date: '2026-02-01', purpose: 'management_fee', amount: 200 },
    ])
    expect(m.outstanding).toEqual([
      { purpose: 'management_fee', amount: 200 },
      { purpose: 'working_capital', amount: 300 },
    ])
    expect(m.overRepaid).toBe(0)
  })

  it('lets a same-day repayment retire a same-day draw, and reports repaying more than was drawn', () => {
    const rows = [ev('repayment', '2026-01-10', 150), ev('draw', '2026-01-10', 100)]
    const m = matchRepayments(rows)
    expect(m.repayments).toEqual([{ repaymentId: rows[0].id, date: '2026-01-10', purpose: 'investment', amount: 100 }])
    expect(m.overRepaid).toBe(50)
  })
})

describe('buildFacilityEntry', () => {
  const accounts = { cash: 'cash', loan: 'loan', interest: 'int' }
  const base = { fundId: 'fund', eventId: 'ev1', date: '2026-01-10', amount: 1234.565, memo: 'Subscription line: draw' }

  it('books a draw as Dr cash / Cr loan payable, tagged with the row', () => {
    const e = buildFacilityEntry({ ...base, type: 'draw' }, accounts)
    expect(e.sourceRef).toBe(facilityEntryRef('ev1'))
    expect(e.sourceType).toBe('manual')
    expect(e.postings.map(p => [p.accountId, p.amount])).toEqual([['cash', 1234.57], ['loan', -1234.57]])
  })

  it('books a repayment as the reverse, and interest as an allocated expense', () => {
    expect(buildFacilityEntry({ ...base, type: 'repayment' }, accounts).postings.map(p => p.accountId)).toEqual(['loan', 'cash'])
    const i = buildFacilityEntry({ ...base, type: 'interest' }, accounts)
    expect(i.sourceType).toBe('partnership_expense')
    expect(i.postings.map(p => [p.accountId, p.amount])).toEqual([['int', 1234.57], ['cash', -1234.57]])
    expect(i.postings.every(p => p.lpEntityId === null)).toBe(true)
  })
})

describe('linkedAmount', () => {
  const accounts = { loan: 'loan', interest: 'int' }
  it('reads what an existing entry moved on the facility account, in the direction the row needs', () => {
    const draw = [{ accountId: 'cash', amount: 500 }, { accountId: 'loan', amount: -500 }]
    expect(linkedAmount('draw', draw, accounts)).toBe(500)
    expect(linkedAmount('repayment', draw, accounts)).toBe(0)
    const interest = [{ accountId: 'int', amount: 42.1 }, { accountId: 'cash', amount: -42.1 }]
    expect(linkedAmount('interest', interest, accounts)).toBe(42.1)
    expect(linkedAmount('fee', draw, accounts)).toBe(0)
  })
})
