import { describe, it, expect } from 'vitest'
import { reconcileSettlements, applySettlements, registerStatus, settlementsFromPostings } from './settlement'

const line = (id: string, lpEntityId: string, date: string, amount: number) => ({ id, lpEntityId, date, amount })

describe('applySettlements', () => {
  it('a wire settles the oldest open line first', () => {
    const out = applySettlements(
      [line('c2', 'a', '2026-03-01', 100), line('c1', 'a', '2026-01-01', 100)],
      [{ lpEntityId: 'a', date: '2026-03-10', amount: 100 }],
    )
    expect(out.get('c1')).toMatchObject({ status: 'settled', settled: 100, outstanding: 0, settledOn: '2026-03-10' })
    expect(out.get('c2')).toMatchObject({ status: 'open', settled: 0, outstanding: 100, settledOn: null })
  })

  it('one wire can fund several calls, and a call can be funded by several wires', () => {
    const out = applySettlements(
      [line('c1', 'a', '2026-01-01', 100), line('c2', 'a', '2026-02-01', 100), line('c3', 'a', '2026-03-01', 100)],
      [{ lpEntityId: 'a', date: '2026-02-05', amount: 150 }, { lpEntityId: 'a', date: '2026-03-05', amount: 75 }],
    )
    expect(out.get('c1')).toMatchObject({ status: 'settled', settledOn: '2026-02-05' })
    expect(out.get('c2')).toMatchObject({ status: 'settled', settled: 100, settledOn: '2026-03-05' })
    expect(out.get('c3')).toMatchObject({ status: 'partial', settled: 25, outstanding: 75, settledOn: null, lastSettlementOn: '2026-03-05' })
  })

  it('never crosses partners', () => {
    const out = applySettlements(
      [line('c1', 'a', '2026-01-01', 100), line('c2', 'b', '2026-01-01', 100)],
      [{ lpEntityId: 'b', date: '2026-01-05', amount: 100 }],
    )
    expect(out.get('c1')?.status).toBe('open')
    expect(out.get('c2')?.status).toBe('settled')
  })

  it('an overpayment is left over rather than invented onto a line', () => {
    const out = applySettlements([line('c1', 'a', '2026-01-01', 100)], [{ lpEntityId: 'a', date: '2026-01-05', amount: 250 }])
    expect(out.get('c1')).toMatchObject({ settled: 100, outstanding: 0 })
  })

  it('a line with no settlements at all is open', () => {
    const out = applySettlements([line('c1', 'a', '2026-01-01', 100)], [])
    expect(out.get('c1')).toMatchObject({ status: 'open', settled: 0, outstanding: 100 })
  })

  it('works to the cent', () => {
    const out = applySettlements(
      [line('c1', 'a', '2026-01-01', 33.33), line('c2', 'a', '2026-01-02', 33.34)],
      [{ lpEntityId: 'a', date: '2026-01-05', amount: 66.67 }],
    )
    expect(out.get('c1')?.status).toBe('settled')
    expect(out.get('c2')?.status).toBe('settled')
  })
})

describe('registerStatus', () => {
  it('rolls lines up and flags overdue only while something is outstanding', () => {
    const lines = [{ settled: 100, outstanding: 0 }, { settled: 20, outstanding: 80 }]
    expect(registerStatus(lines, '2026-01-31', '2026-02-15')).toEqual({ status: 'partial', settled: 120, outstanding: 80, overdue: true })
    expect(registerStatus(lines, '2026-02-28', '2026-02-15')).toMatchObject({ overdue: false })
    expect(registerStatus(lines, null, '2026-02-15')).toMatchObject({ overdue: false })
    expect(registerStatus([{ settled: 100, outstanding: 0 }], '2026-01-01', '2026-02-15')).toEqual({ status: 'settled', settled: 100, outstanding: 0, overdue: false })
  })
})

describe('settlementsFromPostings', () => {
  const postings = [
    { accountId: 'recv', amount: 100, lpEntityId: 'a', entryDate: '2026-01-01' },   // issuance: Dr receivable
    { accountId: 'recv', amount: -60, lpEntityId: 'a', entryDate: '2026-01-10' },   // funding: Cr receivable
    { accountId: 'cash', amount: 60, lpEntityId: null, entryDate: '2026-01-10' },
    { accountId: 'pay', amount: -50, lpEntityId: 'a', entryDate: '2026-02-01' },    // declaration: Cr payable
    { accountId: 'pay', amount: 50, lpEntityId: 'a', entryDate: '2026-02-09' },     // paid: Dr payable
  ]
  it('reads fundings off the receivable and payments off the payable, by sign', () => {
    expect(settlementsFromPostings(postings, 'recv', 'receivable')).toEqual([{ lpEntityId: 'a', date: '2026-01-10', amount: 60 }])
    expect(settlementsFromPostings(postings, 'pay', 'payable')).toEqual([{ lpEntityId: 'a', date: '2026-02-09', amount: 50 }])
  })
})


describe('reconcileSettlements', () => {
  const lines = [line('a1', 'a', '2026-01-01', 100), line('a2', 'a', '2026-02-01', 100), line('b1', 'b', '2026-01-01', 100)]
  const manual = [{ lineId: 'a2', lpEntityId: 'a', date: '2026-02-10', amount: 80 }]
  it('preserves the exact manual line when another partner has imported payments', () => {
    const result = reconcileSettlements(lines, [{ lpEntityId: 'b', date: '2026-02-10', amount: 100 }], manual)
    expect(result.get('a1')?.settled).toBe(0)
    expect(result.get('a2')).toMatchObject({ settled: 80, outstanding: 20 })
    expect(result.get('a2')?.settlementReview).toBeUndefined()
    expect(result.get('b1')?.settled).toBe(100)
  })
  it('does not add potentially duplicate representations, even when totals match', () => {
    const result = reconcileSettlements(lines, [{ lpEntityId: 'a', date: '2026-02-10', amount: 80 }], manual)
    expect(result.get('a1')?.settled).toBe(0)
    expect(result.get('a2')?.settled).toBe(80)
    expect(result.get('a2')?.settlementReview).toContain('reconciliation needed')
  })
  it('retains recorded allocations and exposes conflicting imported totals', () => {
    const result = reconcileSettlements(lines, [{ lpEntityId: 'a', date: '2026-02-10', amount: 120 }], manual)
    expect(result.get('a2')?.settled).toBe(80)
    expect(result.get('a1')?.settlementReview).toContain('120.00')
  })
})

describe('explicit payment links', () => {
  const lines = [line('first', 'a', '2026-01-01', 100), line('second', 'a', '2026-02-01', 100)]
  const manual = [{ lineId: 'second', lpEntityId: 'a', date: '2026-02-10', amount: 80 }]
  const ledger = [{ entryId: 'wire', lpEntityId: 'a', date: '2026-02-10', amount: 120 }]
  const review = { lineId: 'second', manualAmount: 80, manualDate: '2026-02-10', separateRemainder: false, links: [{ entryId: 'wire', amount: 80, entryAmount: 120, date: '2026-02-10' }] }
  it('reserves matched amounts for their original line and applies only the remainder by FIFO', () => {
    const result = reconcileSettlements(lines, ledger, manual, [review])
    expect(result.get('second')).toMatchObject({ settled: 80, outstanding: 20 })
    expect(result.get('second')?.settlementReview).toBeUndefined()
    expect(result.get('first')?.settled).toBe(40)
  })
  it('includes explicitly confirmed separate payments once', () => {
    const result = reconcileSettlements(lines, ledger, manual, [{ ...review, links: [], separateRemainder: true }])
    expect(result.get('first')?.settled).toBe(100)
    expect(result.get('second')?.settled).toBe(100)
  })
  it('reopens review if a linked entry changes, disappears, or the manual record changes', () => {
    for (const payments of [[], [{ ...ledger[0], amount: 125 }], [{ ...ledger[0], date: '2026-02-11' }]]) {
      expect(reconcileSettlements(lines, payments, manual, [review]).get('second')?.settlementReview).toBeTruthy()
    }
    expect(reconcileSettlements(lines, ledger, [{ ...manual[0], amount: 90 }], [review]).get('second')?.settlementReview).toBeTruthy()
  })
  it('nets split posting lines within one journal payment before matching', () => {
    expect(settlementsFromPostings([
      { accountId: 'receivable', lpEntityId: 'a', entryId: 'wire', amount: -100, entryDate: '2026-02-10' },
      { accountId: 'receivable', lpEntityId: 'a', entryId: 'wire', amount: 20, entryDate: '2026-02-10' },
    ], 'receivable', 'receivable')).toEqual([{ entryId: 'wire', lpEntityId: 'a', date: '2026-02-10', amount: 80 }])
  })
})
