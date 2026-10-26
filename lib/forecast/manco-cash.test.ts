import { describe, expect, it } from 'vitest'
import type { Account, Posting } from '@/lib/accounting/types'
import { buildReport } from './report'
import { mancoCashPlan } from './manco-cash'

const A: Account[] = [
  { id: 'op', fundId: 'f', code: '1000', name: 'Cash — operating', type: 'asset', subtype: 'cash' },
  { id: 'ap', fundId: 'f', code: '2000', name: 'Accounts payable', type: 'liability', subtype: 'accounts_payable' },
  { id: 'own', fundId: 'f', code: '3000', name: 'Members’ capital', type: 'equity', subtype: 'lp_capital' },
  { id: 'fee', fundId: 'f', code: '4000', name: 'Management fee income', type: 'income', subtype: 'management_fee_income' },
  { id: 'pay', fundId: 'f', code: '5000', name: 'Salaries', type: 'expense' },
  { id: 'rent', fundId: 'f', code: '5100', name: 'Rent', type: 'expense' },
]
const e = (date: string, legs: [string, number][]) => ({ date, postings: legs.map(([accountId, amount]) => ({ accountId, amount, currency: 'USD', entryDate: date })) as Posting[] })

const ACTUAL = [
  e('2026-01-02', [['op', 100_000], ['own', -100_000]]),
  e('2026-01-05', [['op', 50_000], ['fee', -50_000]]),
  e('2026-01-10', [['pay', 40_000], ['op', -40_000]]),
  e('2026-01-20', [['ap', 5_000], ['op', -5_000]]),
]
const PLAN = [
  e('2026-02-10', [['pay', 40_000], ['op', -40_000]]),
  e('2026-02-15', [['rent', 10_000], ['op', -10_000]]),
  e('2026-03-05', [['op', 50_000], ['fee', -50_000]]),
  e('2026-03-10', [['pay', 40_000], ['op', -40_000]]),
]

const report = (interval: 'month' | 'quarter') => buildReport({
  view: 'combined', accounts: A, actuals: ACTUAL.flatMap(x => x.postings), plan: PLAN.flatMap(x => x.postings),
  planFirst: '2026-02', cutoff: '2026-01', actualsAvailableThrough: '2026-01', closedThrough: '2026-01',
  start: '2026-01', end: '2026-03', interval, actualEntries: ACTUAL, planEntries: PLAN,
})

describe("a management company's cash plan", () => {
  const c = mancoCashPlan(report('month'))!

  it('splits income received and expenses paid into actual and forecast', () => {
    expect(c.income).toEqual([{ key: 'fee', label: 'Management fee income', code: '4000', values: { actual: 50_000, forecast: 50_000, total: 100_000 } }])
    expect(c.expenses.map(l => [l.code, l.values])).toEqual([
      ['5000', { actual: -40_000, forecast: -80_000, total: -120_000 }],
      ['5100', { actual: 0, forecast: -10_000, total: -10_000 }],
    ])
    expect(c.accruals).toEqual({ actual: -5_000, forecast: 0, total: -5_000 })
  })

  it('shows owner money as its own line, and re-adds from opening to ending cash', () => {
    expect(c.other).toEqual([{ key: 'called', label: 'Owner contributions', values: { actual: 100_000, forecast: 0, total: 100_000 } }])
    expect(c.opening).toBe(0)
    expect(c.ending).toBe(65_000)
    expect(c.movement.total).toBe(65_000)
    const lines = [...c.income, ...c.expenses, ...c.other].reduce((s, l) => s + l.values.total, 0) + c.accruals.total
    expect(lines).toBe(c.movement.total)
    expect(c.operating.total).toBe(-35_000)
  })

  it('finds the low point and says whether it is forecast', () => {
    expect(c.low).toEqual({ ending: 55_000, label: report('month').periods[1].label, forecast: true })
  })

  it('counts a quarter that is part forecast as forecast', () => {
    const q = mancoCashPlan(report('quarter'))!
    expect(q.income[0].values).toEqual({ actual: 0, forecast: 100_000, total: 100_000 })
    expect(q.ending).toBe(65_000)
  })

  it('is null without a cash-flow statement', () => {
    expect(mancoCashPlan({ ...report('month'), cashFlows: null })).toBeNull()
  })
})
