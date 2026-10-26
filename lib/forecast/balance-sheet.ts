// The forecast's balance sheet: every asset, liability and equity account at the end of each
// period, from the same posting stream as the income statement and the cash flows (report.ts).
//
// A forecast is stored as balanced entries (compile.ts), so actual balances at the cutoff plus the
// plan's entries after it ARE the projected balance sheet: a fee billed in advance shows as a
// receivable until it is collected, a prepaid cost runs down month by month, and the cash line is
// the cash-flow statement's ending cash. It always balances; `check` says so per period.
//
// Equity is laid out the way the books' own balance sheet lays it out (lib/accounting/statements.ts
// balanceSheet): one line for a fund (per-partner detail belongs in the statement of changes), the
// capital accounts listed for a management company or an individual, and net income that no close
// has moved into capital yet as a line of its own. Books that keep retained earnings roll prior
// years' net income into that account and show the current calendar year's as "Net income".

import type { Account, Posting } from '@/lib/accounting/types'
import { roundCents } from '@/lib/accounting/ledger'
import { RETAINED_EARNINGS_SUBTYPE } from '@/lib/accounting/statements'
import type { MonthKey } from './months'

export interface BalanceSheetRow {
  key: string
  code: string | null
  name: string
  /** Balance at the end of each period, in its natural sign; null where the period has no data. */
  values: (number | null)[]
}

export interface BalanceSheetSection {
  rows: BalanceSheetRow[]
  total: (number | null)[]
}

export interface ForecastBalanceSheet {
  assets: BalanceSheetSection
  liabilities: BalanceSheetSection
  equity: BalanceSheetSection & { label: string }
  /** Assets − liabilities − equity per period: zero whenever the entries balance. */
  check: (number | null)[]
}

export interface BalanceSheetInput {
  accounts: Account[]
  /** The view's postings (actual, plan or combined), from inception. */
  postings: Posting[]
  /** Each period's months, in order. */
  periods: { months: MonthKey[] }[]
  /** Whether the view has data for a month; a period is read at its last such month. */
  hasData: (m: MonthKey) => boolean
  equityLabel?: string
  itemizeEquity?: boolean
}

const BRIDGE_SUBTYPE = 'undistributed_earnings'

export function forecastBalanceSheet(input: BalanceSheetInput): ForecastBalanceSheet {
  const { accounts, periods } = input
  const byId = new Map(accounts.map(a => [a.id, a]))
  // The month each period is read at, or null when it has no data.
  const asOf = periods.map(p => [...p.months].reverse().find(m => input.hasData(m)) ?? null)
  const wanted = new Set(asOf.filter((m): m is MonthKey => m != null))

  // Postings by month, then one pass in date order: balances are running sums.
  const byMonth = new Map<MonthKey, Posting[]>()
  for (const p of input.postings) {
    if (!p.entryDate || !byId.has(p.accountId)) continue
    const m = p.entryDate.slice(0, 7)
    const list = byMonth.get(m)
    if (list) list.push(p)
    else byMonth.set(m, [p])
  }
  const months = [...new Set([...byMonth.keys(), ...wanted])].sort()

  const running = new Map<string, number>()
  let netIncome = 0
  const netIncomeBeforeYear = new Map<string, number>()
  const snapshots = new Map<MonthKey, { balances: Map<string, number>; netIncome: number; priorYears: number }>()
  for (const m of months) {
    const year = m.slice(0, 4)
    if (!netIncomeBeforeYear.has(year)) netIncomeBeforeYear.set(year, netIncome)
    for (const p of byMonth.get(m) ?? []) {
      const a = byId.get(p.accountId)!
      if (a.type === 'income' || a.type === 'expense') netIncome -= p.amount // credit-normal: a credit is income
      else running.set(a.id, (running.get(a.id) ?? 0) + p.amount)
    }
    if (wanted.has(m)) snapshots.set(m, { balances: new Map(running), netIncome, priorYears: netIncomeBeforeYear.get(year)! })
  }

  // Natural sign: assets are debit-normal, liabilities and equity credit-normal.
  const natural = (a: Account, debit: number) => roundCents(a.type === 'asset' ? debit : -debit)
  const at = (i: number) => (asOf[i] ? snapshots.get(asOf[i]!)! : null)
  const accountValues = (a: Account) => periods.map((_, i) => {
    const s = at(i)
    return s ? natural(a, s.balances.get(a.id) ?? 0) : null
  })
  const moved = (values: (number | null)[]) => values.some(v => v != null && Math.abs(v) >= 0.005)
  const rowsOf = (type: Account['type']) => accounts
    .filter(a => a.type === type)
    .sort((a, b) => a.code.localeCompare(b.code))
    .map(a => ({ key: a.id, code: a.code, name: a.name, values: accountValues(a) }))
    .filter(r => moved(r.values))
  const sum = (rows: BalanceSheetRow[]) => periods.map((_, i) => (at(i) ? roundCents(rows.reduce((s, r) => s + (r.values[i] ?? 0), 0)) : null))
  const perPeriod = (f: (s: NonNullable<ReturnType<typeof at>>) => number) => periods.map((_, i) => {
    const s = at(i)
    return s ? roundCents(f(s)) : null
  })

  const assets = rowsOf('asset')
  const liabilities = rowsOf('liability')
  const label = input.equityLabel ?? "Partners' capital"
  const equityAccounts = accounts.filter(a => a.type === 'equity')
  const bridge = equityAccounts.find(a => a.subtype === BRIDGE_SUBTYPE)
  const retained = equityAccounts.find(a => a.subtype === RETAINED_EARNINGS_SUBTYPE)
  const capitalOf = (s: NonNullable<ReturnType<typeof at>>, except?: Account) =>
    equityAccounts.filter(a => a !== except).reduce((t, a) => t - (s.balances.get(a.id) ?? 0), 0)

  let equity: BalanceSheetRow[]
  if (retained) {
    // Prior years roll into retained earnings; the current year is its own line.
    const accountRows = (input.itemizeEquity ? equityAccounts : []).map(a => ({
      key: a.id, code: a.code, name: a.name,
      values: a === retained ? perPeriod(s => -(s.balances.get(a.id) ?? 0) + s.priorYears) : accountValues(a),
    }))
    equity = [
      ...(input.itemizeEquity ? accountRows : [{ key: 'capital', code: null, name: label, values: perPeriod(s => capitalOf(s) + s.priorYears) }]),
      { key: 'net_income', code: null, name: 'Net income', values: perPeriod(s => s.netIncome - s.priorYears) },
    ]
  } else {
    // Net income a close has already moved into capital sits as a debit in the bridge; what is left
    // of net income after it is what no close has allocated yet.
    const unclosed = perPeriod(s => s.netIncome - (bridge ? s.balances.get(bridge.id) ?? 0 : 0))
    equity = [
      ...(input.itemizeEquity
        ? equityAccounts.filter(a => a !== bridge).sort((a, b) => a.code.localeCompare(b.code)).map(a => ({ key: a.id, code: a.code, name: a.name, values: accountValues(a) }))
        : [{ key: 'capital', code: null, name: label, values: perPeriod(s => capitalOf(s, bridge)) }]),
      { key: 'net_income', code: null, name: 'Net income not yet closed', values: unclosed },
    ]
  }
  equity = equity.filter(r => moved(r.values))

  const assetTotal = sum(assets)
  const liabilityTotal = sum(liabilities)
  const equityTotal = perPeriod(s => capitalOf(s) + s.netIncome)
  return {
    assets: { rows: assets, total: assetTotal },
    liabilities: { rows: liabilities, total: liabilityTotal },
    equity: { label, rows: equity, total: equityTotal },
    check: periods.map((_, i) => (at(i) ? roundCents(assetTotal[i]! - liabilityTotal[i]! - equityTotal[i]!) : null)),
  }
}
