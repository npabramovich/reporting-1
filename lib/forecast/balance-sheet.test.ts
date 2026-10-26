import { describe, expect, it } from 'vitest'
import type { Account, Posting } from '@/lib/accounting/types'
import { buildReport, type ReportInput } from './report'
import { forecastBalanceSheet } from './balance-sheet'

const A: Account[] = [
  { id: 'op', fundId: 'f', code: '1000', name: 'Cash — operating', type: 'asset', subtype: 'cash' },
  { id: 'ar', fundId: 'f', code: '1200', name: 'Fees receivable', type: 'asset', subtype: 'receivable' },
  { id: 'pre', fundId: 'f', code: '1300', name: 'Prepaid expenses', type: 'asset', subtype: 'prepaid' },
  { id: 'ap', fundId: 'f', code: '2000', name: 'Accounts payable', type: 'liability', subtype: 'accounts_payable' },
  { id: 'm1', fundId: 'f', code: '3000', name: 'Member capital — Jane Doe', type: 'equity', subtype: 'member_capital' },
  { id: 'bridge', fundId: 'f', code: '3900', name: 'Undistributed earnings', type: 'equity', subtype: 'undistributed_earnings' },
  { id: 'fee', fundId: 'f', code: '4000', name: 'Management fee income', type: 'income', subtype: 'management_fee_income' },
  { id: 'rent', fundId: 'f', code: '5100', name: 'Rent', type: 'expense' },
  { id: 'ins', fundId: 'f', code: '5200', name: 'Insurance', type: 'expense' },
]
const e = (date: string, legs: [string, number][]) => ({ date, postings: legs.map(([accountId, amount]) => ({ accountId, amount, currency: 'USD', entryDate: date })) as Posting[] })

const ACTUAL = [
  e('2025-12-01', [['op', 100_000], ['m1', -100_000]]),
  e('2026-01-05', [['ar', 30_000], ['fee', -30_000]]),
  e('2026-01-10', [['rent', 5_000], ['ap', -5_000]]),
]
const PLAN = [
  e('2026-02-03', [['op', 30_000], ['ar', -30_000]]),
  e('2026-02-10', [['ap', 5_000], ['op', -5_000]]),
  e('2026-02-15', [['pre', 1_200], ['op', -1_200]]),
  e('2026-02-28', [['ins', 100], ['pre', -100]]),
  e('2026-03-28', [['ins', 100], ['pre', -100]]),
]

const base = (over: Partial<ReportInput> = {}): ReportInput => ({
  view: 'combined', accounts: A, actuals: ACTUAL.flatMap(x => x.postings), plan: PLAN.flatMap(x => x.postings),
  planFirst: '2026-02', planLast: '2026-03', cutoff: '2026-01', actualsAvailableThrough: '2026-01', closedThrough: '2026-01',
  start: '2026-01', end: '2026-04', interval: 'month', actualEntries: ACTUAL, planEntries: PLAN,
  equityLabel: "Members' capital", itemizeEquity: true, ...over,
})

describe('forecast balance sheet', () => {
  const r = buildReport(base())
  const bs = r.balanceSheet!
  const row = (section: 'assets' | 'liabilities' | 'equity', key: string) => bs[section].rows.find(x => x.key === key)?.values

  it('carries actual balances into the plan and moves them with its entries', () => {
    expect(row('assets', 'op')).toEqual([100_000, 123_800, 123_800, null])
    expect(row('assets', 'ar')).toEqual([30_000, 0, 0, null])
    expect(row('assets', 'pre')).toEqual([0, 1_100, 1_000, null])
    expect(row('liabilities', 'ap')).toEqual([5_000, 0, 0, null])
  })

  it('agrees with the cash-flow statement on cash', () => {
    expect(row('assets', 'op')!.slice(0, 3)).toEqual(r.cash.slice(0, 3).map(c => c!.ending))
  })

  it("lists a management company's capital accounts and the net income no close has moved", () => {
    expect(bs.equity.label).toBe("Members' capital")
    expect(bs.equity.rows.map(x => [x.name, x.values])).toEqual([
      ['Member capital — Jane Doe', [100_000, 100_000, 100_000, null]],
      ['Net income not yet closed', [25_000, 24_900, 24_800, null]],
    ])
  })

  it('balances in every period with data, and is blank past the plan', () => {
    expect(bs.check).toEqual([0, 0, 0, null])
    expect(bs.assets.total).toEqual([130_000, 124_900, 124_800, null])
  })

  it('takes a quarter at its last month with data', () => {
    const q = buildReport(base({ interval: 'quarter', end: '2026-06' })).balanceSheet!
    expect(q.assets.total).toEqual([124_800, null])
    expect(q.check).toEqual([0, null])
  })

  it('shows a fund one equity line, with closed net income out of the unclosed line', () => {
    const close = e('2026-01-31', [['bridge', 25_000], ['m1', -25_000]])
    const f = buildReport(base({ actuals: [...ACTUAL, close].flatMap(x => x.postings), equityLabel: "Partners' capital", itemizeEquity: false })).balanceSheet!
    expect(f.equity.rows.map(x => [x.name, x.values[0], x.values[2]])).toEqual([
      ["Partners' capital", 125_000, 125_000],
      ['Net income not yet closed', 0, -200],
    ])
    expect(f.check).toEqual([0, 0, 0, null])
  })

  it('rolls prior years into retained earnings on books that keep them', () => {
    const accounts: Account[] = [...A, { id: 're', fundId: 'f', code: '3800', name: 'Retained earnings', type: 'equity', subtype: 'retained_earnings' }]
    const postings = [
      e('2025-06-01', [['op', 10_000], ['fee', -10_000]]),
      e('2026-01-05', [['op', 4_000], ['fee', -4_000]]),
    ].flatMap(x => x.postings)
    const out = forecastBalanceSheet({ accounts, postings, periods: [{ months: ['2026-01'] }], hasData: () => true, equityLabel: "Members' capital", itemizeEquity: true })
    expect(out.equity.rows.map(x => [x.name, x.values[0]])).toEqual([['Retained earnings', 10_000], ['Net income', 4_000]])
    expect(out.check).toEqual([0])
  })
})
