import { describe, it, expect } from 'vitest'
import { investmentCostCode, investmentUnrealizedCode } from './investments'
import { scheduleOfInvestments, balanceSheet, postingsAsOf } from './statements'
import type { Account, Posting } from './types'

const CO_A = 'aaaaaaaa-1111-2222-3333-444444444444'
const CO_B = 'bbbbbbbb-1111-2222-3333-444444444444'

const accounts: Account[] = [
  { id: 'cash', fundId: 'f', code: '1000', name: 'Cash', type: 'asset', subtype: 'cash' },
  { id: 'costA', fundId: 'f', code: investmentCostCode(CO_A), name: 'Investment — A', type: 'asset', subtype: 'investment', companyId: CO_A },
  { id: 'unrlA', fundId: 'f', code: investmentUnrealizedCode(CO_A), name: 'Unrealized — A', type: 'asset', subtype: 'unrealized', companyId: CO_A },
  { id: 'costB', fundId: 'f', code: investmentCostCode(CO_B), name: 'Investment — B', type: 'asset', subtype: 'investment', companyId: CO_B },
  { id: 'unrlB', fundId: 'f', code: investmentUnrealizedCode(CO_B), name: 'Unrealized — B', type: 'asset', subtype: 'unrealized', companyId: CO_B },
  { id: 'cap', fundId: 'f', code: '3100', name: "Partners' capital", type: 'equity', subtype: 'lp_capital' },
  { id: 'unrlInc', fundId: 'f', code: '4200', name: 'Change in unrealized', type: 'income', subtype: 'unrealized' },
]

describe('per-investment account codes', () => {
  it('are derived from the company id, and are distinct per company', () => {
    expect(investmentCostCode(CO_A)).toBe('1100-aaaaaaaa')
    expect(investmentUnrealizedCode(CO_A)).toBe('1200-aaaaaaaa')
    expect(investmentCostCode(CO_B)).not.toBe(investmentCostCode(CO_A))
  })
})

describe('per-company tie-out', () => {
  // A: cost 100, marked to 150. B: cost 200, marked to 180.
  const postings: Posting[] = [
    { accountId: 'costA', amount: 100, currency: 'USD' },
    { accountId: 'unrlA', amount: 50, currency: 'USD' },
    { accountId: 'costB', amount: 200, currency: 'USD' },
    { accountId: 'unrlB', amount: -20, currency: 'USD' },
    { accountId: 'cash', amount: -300, currency: 'USD' },
    { accountId: 'unrlInc', amount: -30, currency: 'USD' },
  ]

  it('reports each position against its OWN ledger accounts', () => {
    const soi = scheduleOfInvestments(accounts, postings, 1_000, [
      { companyId: CO_A, name: 'A', cost: 100, fairValue: 150 },
      { companyId: CO_B, name: 'B', cost: 200, fairValue: 180 },
    ] as any)

    const a = soi.rows.find(r => r.name === 'A')!
    expect(a.ledgerCost).toBe(100)
    expect(a.ledgerFairValue).toBe(150)
    expect(a.tiesOut).toBe(true)

    const b = soi.rows.find(r => r.name === 'B')!
    expect(b.ledgerFairValue).toBe(180)
    expect(b.tiesOut).toBe(true)
  })

  it('CATCHES two offsetting errors that the total-only tie-out would hide', () => {
    // The tracker says A is 50 too high and B is 50 too low. The TOTAL still ties
    // exactly — which is precisely the failure the aggregate account could not see.
    const soi = scheduleOfInvestments(accounts, postings, 1_000, [
      { companyId: CO_A, name: 'A', cost: 150, fairValue: 200 },
      { companyId: CO_B, name: 'B', cost: 150, fairValue: 130 },
    ] as any)

    expect(soi.costVariance).toBe(0)       // total ties…
    expect(soi.fairValueVariance).toBe(0)  // …and so does fair value

    // …but both positions are individually wrong, and now we can say so.
    expect(soi.rows.find(r => r.name === 'A')!.tiesOut).toBe(false)
    expect(soi.rows.find(r => r.name === 'B')!.tiesOut).toBe(false)
  })

  it('leaves tiesOut undefined when the company has no ledger accounts', () => {
    const soi = scheduleOfInvestments(accounts, postings, 1_000, [
      { companyId: 'cccccccc-0000-0000-0000-000000000000', name: 'C', cost: 10, fairValue: 10 },
    ] as any)
    const c = soi.rows[0]
    expect(c.ledgerCost).toBeUndefined()
    expect(c.tiesOut).toBeUndefined() // don't claim a tie-out we can't actually make
  })

  it('a write-off zeroes the carrying value but leaves cost on the books', () => {
    // B written off: its unrealized offsets its full cost.
    const written: Posting[] = [
      { accountId: 'costB', amount: 200, currency: 'USD' },
      { accountId: 'unrlB', amount: -200, currency: 'USD' },
      { accountId: 'cash', amount: -200, currency: 'USD' },
      { accountId: 'unrlInc', amount: 200, currency: 'USD' },
    ]
    const soi = scheduleOfInvestments(accounts, written, 1_000, [
      { companyId: CO_B, name: 'B', cost: 200, fairValue: 0 },
    ] as any)
    const b = soi.rows[0]
    expect(b.ledgerCost).toBe(200)      // cost stays
    expect(b.ledgerFairValue).toBe(0)   // carrying value is nil
    expect(b.tiesOut).toBe(true)
  })

  it('totals still sum every per-company account, so the aggregate is unchanged', () => {
    const soi = scheduleOfInvestments(accounts, postings, 1_000, [])
    expect(soi.ledgerCost).toBe(300)       // 100 + 200
    expect(soi.ledgerFairValue).toBe(330)  // 300 + 50 − 20
  })
})

describe('bootstrapping investments must not double-count equity', () => {
  it('reclassifying out of cash leaves partners’ capital untouched', () => {
    // The cutover opening put the whole NAV in cash and credited capital.
    const opening: Posting[] = [
      { accountId: 'cash', amount: 1_000, currency: 'USD' },
      { accountId: 'cap', amount: -1_000, currency: 'USD' },
    ]
    const before = balanceSheet(accounts, postingsAsOf(opening, null))
    expect(before.partnersCapital.total).toBe(1_000)
    expect(before.check).toBe(0)

    // Bootstrap: move 300 of cost + 30 of unrealized OUT of cash. Equity must not move.
    const bootstrap: Posting[] = [
      ...opening,
      { accountId: 'costA', amount: 100, currency: 'USD' },
      { accountId: 'unrlA', amount: 50, currency: 'USD' },
      { accountId: 'costB', amount: 200, currency: 'USD' },
      { accountId: 'unrlB', amount: -20, currency: 'USD' },
      { accountId: 'cash', amount: -330, currency: 'USD' },
    ]
    const after = balanceSheet(accounts, postingsAsOf(bootstrap, null))

    expect(after.partnersCapital.total).toBe(1_000) // unchanged — the point
    expect(after.assets.total).toBe(1_000)          // 670 cash + 300 cost + 30 unrealized
    expect(after.check).toBe(0)
  })

  it('crediting capital instead would book the fund’s equity TWICE', () => {
    // The bug this guards against.
    const wrong: Posting[] = [
      { accountId: 'cash', amount: 1_000, currency: 'USD' },
      { accountId: 'cap', amount: -1_000, currency: 'USD' },
      { accountId: 'costA', amount: 300, currency: 'USD' },
      { accountId: 'cap', amount: -300, currency: 'USD' }, // ← wrong offset
    ]
    const bs = balanceSheet(accounts, postingsAsOf(wrong, null))
    expect(bs.partnersCapital.total).toBe(1_300) // inflated by the investment
  })
})
