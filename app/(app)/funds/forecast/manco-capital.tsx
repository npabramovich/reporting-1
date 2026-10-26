'use client'

import { Fragment } from 'react'
import { cn } from '@/lib/utils'
import type { CashSplit, MancoCashPlan } from '@/lib/forecast/manco-cash'

/**
 * Capital planning for a management company: its cash over the page's date range, one row per
 * line, split into what has happened (Actual) and what the plan still has to come (Forecast). It has
 * no portfolio, so construction's capital table has nothing to show; the question here is whether
 * fee income covers what it spends, and how low the cash gets on the way.
 */
export function MancoCapitalPlanning({ plan, rangeLabel, hasPlan, onEntityLinks, fmt, fmtFull }: {
  plan: MancoCashPlan | null
  rangeLabel: string
  hasPlan: boolean
  onEntityLinks: () => void
  fmt: (v: number | null) => string
  fmtFull: (v: number | null) => string
}) {
  if (!plan) {
    return <p className="mb-6 text-sm text-muted-foreground">No cash has moved in this range yet, and there is no plan to forecast it from.</p>
  }
  type Line = { key: string; label: string; code?: string | null; values?: CashSplit; total?: number; strong?: boolean; warn?: boolean }
  const sumOf = (ls: { values: CashSplit }[]): CashSplit => ({
    actual: ls.reduce((s, l) => s + l.values.actual, 0),
    forecast: ls.reduce((s, l) => s + l.values.forecast, 0),
    total: ls.reduce((s, l) => s + l.values.total, 0),
  })
  const moved = (v: CashSplit) => Math.abs(v.actual) >= 0.5 || Math.abs(v.forecast) >= 0.5
  const groups: { title: string; lines: Line[] }[] = [
    { title: 'Cash', lines: [{ key: 'opening', label: 'Opening cash', total: plan.opening, strong: true }] },
    { title: 'Income received', lines: plan.income.length > 1
      ? [...plan.income, { key: 'income', label: 'Total income received', values: sumOf(plan.income), strong: true }]
      : plan.income },
    { title: 'Expenses paid', lines: plan.expenses.length > 1
      ? [...plan.expenses, { key: 'expenses', label: 'Total expenses paid', values: sumOf(plan.expenses), strong: true }]
      : plan.expenses },
    { title: 'Operating cash', lines: [
      ...(moved(plan.accruals) ? [{ key: 'accruals', label: 'Receivables, payables and prepaids settled', values: plan.accruals }] : []),
      { key: 'operating', label: 'Net operating cash', values: plan.operating, strong: true, warn: plan.operating.total < 0 },
    ] },
    { title: 'Funds, owners and lenders', lines: plan.other },
    { title: 'Ending cash', lines: [
      { key: 'movement', label: 'Net cash movement', values: plan.movement },
      { key: 'ending', label: 'Ending cash', total: plan.ending, strong: true, warn: plan.ending < 0 },
    ] },
  ]
  const noFeeForecast = hasPlan && !plan.income.some(l => Math.abs(l.values.forecast) >= 0.5)
  const cell = (v: number | null | undefined, cls = '') => (
    <td className={cn('px-3 py-2 text-right tabular-nums', cls)} title={v == null ? undefined : fmtFull(v)}>{v == null ? '' : fmt(v)}</td>
  )
  return (
    <div className="mb-6 space-y-3">
      {noFeeForecast && (
        <p className="text-sm text-muted-foreground">
          No income is forecast in this range. Fee income comes from the funds this company manages:{' '}
          <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={onEntityLinks}>link them under Entity links</button>,
          then give the fee income account a linked fee rule on Financials.
        </p>
      )}
      <div className="overflow-x-auto rounded-card border bg-card shadow-sm dark:shadow-none dark:border">
        <table className="w-full whitespace-nowrap text-sm">
          <thead><tr className="border-b bg-muted/50">
            <th className="px-3 py-2 text-left font-medium">Capital planning<span className="ml-2 text-xs font-normal text-muted-foreground">{rangeLabel}</span></th>
            <th className="px-3 py-2 text-right font-medium">Actual</th>
            <th className="px-3 py-2 text-right font-medium">Forecast</th>
            <th className="px-3 py-2 text-right font-medium">Total</th>
          </tr></thead>
          <tbody>
            {groups.filter(g => g.lines.length > 0).map(g => (
              <Fragment key={g.title}>
                <tr className="border-b"><td colSpan={4} className="px-3 pt-3 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{g.title}</td></tr>
                {g.lines.map(l => (
                  <tr key={l.key} className={cn('border-b last:border-b-0', l.strong && 'font-medium')}>
                    <td className={cn('px-3 py-2', l.warn && 'text-destructive')}>
                      {l.code && <span className="mr-2 text-xs font-normal text-muted-foreground tabular-nums">{l.code}</span>}{l.label}
                    </td>
                    {cell(l.values?.actual)}
                    {cell(l.values?.forecast)}
                    {cell(l.values ? l.values.total : l.total, l.warn ? 'text-destructive' : '')}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {plan.low && (
        <p className={cn('text-sm', plan.low.ending < 0 ? 'text-destructive' : 'text-muted-foreground')}>
          Lowest cash in the range: <span className="tabular-nums" title={fmtFull(plan.low.ending)}>{fmt(plan.low.ending)}</span> at the end of {plan.low.label}
          {plan.low.forecast ? ' (forecast)' : ''}.
        </p>
      )}
    </div>
  )
}
