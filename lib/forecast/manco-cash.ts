// A management company's Capital planning: its cash over the page's date range. It has no portfolio
// and no commitments to plan, so the question is whether fee income covers what it spends and how
// low its cash gets. Read from the series' cash-flow statement, so the two cannot disagree: income
// received and expenses paid are the cash-basis income statement, everything else that moved the
// bank is the cash flows' own categories.

import type { FlowCategory, Report } from './report'

export type CashSplit = { actual: number; forecast: number; total: number }

export interface MancoCashLine {
  key: string
  label: string
  code?: string | null
  /** Cash in positive, cash out negative. */
  values: CashSplit
}

export interface MancoCashPlan {
  /** Cash at the start of the range's first period with data. */
  opening: number
  income: MancoCashLine[]
  expenses: MancoCashLine[]
  /** Cash that settled a receivable, payable or prepaid with no P&L account on the entry. */
  accruals: CashSplit
  /** Investing and financing: money put into or taken out of the funds, the owners and lenders. */
  other: MancoCashLine[]
  operating: CashSplit
  movement: CashSplit
  ending: number
  /** The lowest period-end cash in the range, and the period it falls in. */
  low: { ending: number; label: string; forecast: boolean } | null
}

const OTHER: { key: Exclude<FlowCategory, 'operating'>; label: string }[] = [
  { key: 'invested', label: 'Invested in funds' },
  { key: 'proceeds', label: 'Proceeds from funds' },
  { key: 'called', label: 'Owner contributions' },
  { key: 'distributed', label: 'Owner distributions' },
  { key: 'borrowed', label: 'Borrowings' },
  { key: 'repaid', label: 'Loan repayments' },
]

const round = (v: number) => Math.round(v * 100) / 100

/** Null when the series has no cash-flow statement (nothing posted and no plan). */
export function mancoCashPlan(s: Pick<Report, 'periods' | 'cash' | 'cashFlows' | 'cashBasis'>): MancoCashPlan | null {
  if (!s.cashFlows || !s.cashBasis) return null
  const withData = s.periods.map((p, i) => ({ p, i })).filter(({ p, i }) => p.status !== 'none' && s.cash[i])
  if (!withData.length) return null
  // A quarter or year that is part actual, part forecast counts as forecast, as a fund's does.
  const isActual = (i: number) => s.periods[i].status === 'actual' || s.periods[i].status === 'actual_unclosed'
  const split = (values: number[]): CashSplit => {
    let actual = 0, forecast = 0
    for (const { i } of withData) {
      if (isActual(i)) actual += values[i] ?? 0
      else forecast += values[i] ?? 0
    }
    return { actual: round(actual), forecast: round(forecast), total: round(actual + forecast) }
  }
  const nonZero = (l: MancoCashLine) => Math.abs(l.values.actual) >= 0.005 || Math.abs(l.values.forecast) >= 0.005
  const pnl = (type: 'income' | 'expense', sign: 1 | -1) => s.cashBasis!.lines
    .filter(l => l.type === type)
    .map(l => ({ key: l.accountId, label: l.name, code: l.code, values: split(l.values.map(v => sign * v)) }))
    .filter(nonZero)

  const first = s.cash[withData[0].i]!
  const last = s.cash[withData[withData.length - 1].i]!
  let low: MancoCashPlan['low'] = null
  for (const { p, i } of withData) {
    const ending = s.cash[i]!.ending
    if (!low || ending < low.ending) low = { ending, label: p.label, forecast: !isActual(i) }
  }
  return {
    opening: first.opening,
    income: pnl('income', 1),
    expenses: pnl('expense', -1),
    accruals: split(s.cashBasis.accruals),
    other: OTHER.map(o => ({ key: o.key, label: o.label, values: split(s.cashFlows![o.key]) })).filter(nonZero),
    operating: split(s.cashFlows.operating),
    movement: split(s.cash.map(c => c?.movement ?? 0)),
    ending: last.ending,
    low,
  }
}
