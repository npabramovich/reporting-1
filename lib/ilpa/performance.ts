// A vehicle's returns as the ILPA Performance Template (Granular Methodology, v. 1.1) states them,
// in this app's own layout and under ILPA's field and transaction-type names. Pure: the loader
// (performance-load.ts) turns the books and the credit facility register into typed cash flows, and
// everything here is arithmetic on those flows, so a test can pin it.
//
// The flows are the fee-paying limited partners' share of the fund, since inception, through one
// date. Each carries one of ILPA's transaction types, and the type alone decides which of the eight
// returns it enters (performance-types.ts). So the with/without facility and net/gross figures all
// come from the same rows, and anyone can re-derive one by filtering the cash flow table.

import { roundCents } from '@/lib/accounting/ledger'
import { xirr } from '@/lib/xirr'
import {
  ILPA_PERFORMANCE_METHODOLOGY,
  ILPA_PERFORMANCE_VERSION,
  PERFORMANCE_SERIES,
  PERFORMANCE_TYPES,
  SERIES_LABEL,
  TREATMENT,
  type PerformanceSeries,
  type PerformanceType,
} from './performance-types'

export interface PerformanceFlow {
  date: string
  type: PerformanceType
  /** From the partners' side: paid in negative, paid out positive. */
  amount: number
}

export interface SeriesResult {
  irr: number | null
  /** Net TVPI for the net series, gross fund-level MOIC for the gross ones. */
  multiple: number | null
  numerator: number
  denominator: number
}

export interface PortfolioSlice {
  invested: number
  realized: number
  unrealized: number
  grossIrr: number | null
  grossMoic: number | null
}

export interface PortfolioPerformance {
  realized: PortfolioSlice
  unrealized: PortfolioSlice
  total: PortfolioSlice
}

/** One holding, for the portfolio table: its dated cash flows and its value today. */
export interface PortfolioHolding {
  /** Fully exited or written off. */
  realized: boolean
  invested: number
  proceeds: number
  value: number
  /** Fund side: an investment negative, proceeds positive. */
  flows: { date: string; amount: number }[]
}

export interface IlpaPerformance {
  template: { name: 'ILPA Performance Template'; methodology: string; version: string }
  fund: { name: string; vehicle: string; currency: string; asOf: string; basis: 'Since inception' }
  population: {
    feePayingPartners: number
    excludedPartners: number
    feePayingCommitment: number
    totalCommitment: number
  }
  series: Record<PerformanceSeries, SeriesResult>
  /** One row per date and type, oldest first. */
  flows: PerformanceFlow[]
  /** Each type's total, in the template's order, for the types that occur. */
  totals: { type: PerformanceType; amount: number }[]
  portfolio: PortfolioPerformance | null
  facilities: { name: string; kind: string; outstanding: number; inWithoutSeries: boolean }[]
  footnotes: string[]
}

/** Merge rows of the same date and type, drop the zeros, oldest first then template order. */
export function consolidateFlows(flows: PerformanceFlow[]): PerformanceFlow[] {
  const byKey = new Map<string, PerformanceFlow>()
  for (const f of flows) {
    const key = `${f.date}|${f.type}`
    const row = byKey.get(key) ?? { date: f.date, type: f.type, amount: 0 }
    row.amount += f.amount
    byKey.set(key, row)
  }
  const order = (t: PerformanceType) => PERFORMANCE_TYPES.indexOf(t)
  return Array.from(byKey.values())
    .map(r => ({ ...r, amount: roundCents(r.amount) }))
    .filter(r => Math.abs(r.amount) >= 0.005)
    .sort((a, b) => a.date.localeCompare(b.date) || order(a.type) - order(b.type))
}

/** IRR and multiple for one series: the flows its types enter, as the mapping sheet says. */
export function computeSeries(flows: PerformanceFlow[], series: PerformanceSeries): SeriesResult {
  const included = flows.filter(f => TREATMENT[f.type][series])
  let numerator = 0
  let denominator = 0
  for (const f of included) {
    const role = TREATMENT[f.type].role
    if (role === 'numerator') numerator += f.amount
    else if (role === 'denominator') denominator += -f.amount
    else denominator -= f.amount
  }
  numerator = roundCents(numerator)
  denominator = roundCents(denominator)

  const byDate = new Map<string, number>()
  for (const f of included) byDate.set(f.date, (byDate.get(f.date) ?? 0) + f.amount)
  const dated = Array.from(byDate.entries())
    .filter(([, a]) => Math.abs(a) >= 0.005)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, amount]) => ({ date: new Date(`${date}T00:00:00Z`), amount: roundCents(amount) }))
  return {
    irr: dated.length >= 2 ? xirr(dated) : null,
    multiple: denominator > 0.005 ? numerator / denominator : null,
    numerator,
    denominator,
  }
}

/** Gross IRR and MOIC of the realized, unrealized and whole portfolio (fund ↔ investments). */
export function portfolioPerformance(holdings: PortfolioHolding[], asOf: string): PortfolioPerformance {
  const slice = (hs: PortfolioHolding[]): PortfolioSlice => {
    const invested = roundCents(hs.reduce((s, h) => s + h.invested, 0))
    const realized = roundCents(hs.reduce((s, h) => s + h.proceeds, 0))
    const unrealized = roundCents(hs.reduce((s, h) => s + h.value, 0))
    const byDate = new Map<string, number>()
    for (const h of hs) for (const f of h.flows) if (f.date <= asOf) byDate.set(f.date, (byDate.get(f.date) ?? 0) + f.amount)
    if (Math.abs(unrealized) >= 0.005) byDate.set(asOf, (byDate.get(asOf) ?? 0) + unrealized)
    const flows = Array.from(byDate.entries())
      .filter(([, a]) => Math.abs(a) >= 0.005)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, amount]) => ({ date: new Date(`${date}T00:00:00Z`), amount }))
    return {
      invested,
      realized,
      unrealized,
      grossIrr: flows.length >= 2 ? xirr(flows) : null,
      grossMoic: invested > 0.005 ? (realized + unrealized) / invested : null,
    }
  }
  return {
    realized: slice(holdings.filter(h => h.realized)),
    unrealized: slice(holdings.filter(h => !h.realized)),
    total: slice(holdings),
  }
}

export function buildIlpaPerformance(input: Omit<IlpaPerformance, 'template' | 'series' | 'flows' | 'totals'> & { flows: PerformanceFlow[] }): IlpaPerformance {
  const flows = consolidateFlows(input.flows.filter(f => f.date <= input.fund.asOf))
  const series = Object.fromEntries(PERFORMANCE_SERIES.map(s => [s, computeSeries(flows, s)])) as Record<PerformanceSeries, SeriesResult>
  const totals = PERFORMANCE_TYPES
    .map(type => ({ type, amount: roundCents(flows.filter(f => f.type === type).reduce((s, f) => s + f.amount, 0)) }))
    .filter(t => Math.abs(t.amount) >= 0.005)
  return {
    template: { name: 'ILPA Performance Template', methodology: ILPA_PERFORMANCE_METHODOLOGY, version: ILPA_PERFORMANCE_VERSION },
    ...input,
    series,
    flows,
    totals,
  }
}

type Cell = string | number | null

const pct = (v: number | null) => (v == null ? null : Math.round(v * 10000) / 10000)
const mult = (v: number | null) => (v == null ? null : Math.round(v * 100) / 100)
const yn = (b: boolean) => (b ? 'Included' : '')

/**
 * The spreadsheet, one block after another: the fund, the fund performance table, the portfolio
 * table, the cash flows (with the series each enters, so a reader can rebuild any figure), the
 * type totals and the notes. IRRs are fractions (0.1234 = 12.34%), multiples to two places.
 */
export function performanceSheetRows(p: IlpaPerformance): Cell[][] {
  const rows: Cell[][] = []
  rows.push([`${p.template.name} (${p.template.methodology} Methodology, v. ${p.template.version}) data`])
  rows.push([])
  rows.push(['Fund'])
  rows.push(['Fund Name', p.fund.name])
  rows.push(['Vehicle', p.fund.vehicle])
  rows.push(['As of', p.fund.asOf])
  rows.push(['Fund Reporting Currency', p.fund.currency])
  rows.push(['Data', p.fund.basis])
  rows.push(['Fee-paying LPs included', p.population.feePayingPartners])
  rows.push(['Partners excluded (GP and non-fee-paying)', p.population.excludedPartners])
  rows.push(["Fee-paying LPs' commitments", p.population.feePayingCommitment])
  rows.push(['Total fund commitments', p.population.totalCommitment])
  rows.push([])

  rows.push(['Fund Performance (Fund ↔ Investor Cash Flows)'])
  rows.push(['Performance Measure', 'Value', 'Numerator', 'Denominator'])
  for (const s of PERFORMANCE_SERIES) {
    const r = p.series[s]
    rows.push([SERIES_LABEL[s].irr, pct(r.irr), null, null])
    rows.push([SERIES_LABEL[s].multiple, mult(r.multiple), r.numerator, r.denominator])
  }
  rows.push([])

  if (p.portfolio) {
    rows.push(['Gross Portfolio Performance (Fund ↔ Investment Cash Flows)'])
    rows.push(['Performance Measure', 'Realized Portfolio', 'Unrealized Portfolio', 'Total Portfolio'])
    const { realized: r, unrealized: u, total: t } = p.portfolio
    rows.push(['Gross IRR', pct(r.grossIrr), pct(u.grossIrr), pct(t.grossIrr)])
    rows.push(['Gross MOIC', mult(r.grossMoic), mult(u.grossMoic), mult(t.grossMoic)])
    rows.push(['Invested Capital', r.invested, u.invested, t.invested])
    rows.push(['Realized Proceeds', r.realized, u.realized, t.realized])
    rows.push(['Fair Market Value', r.unrealized, u.unrealized, t.unrealized])
    rows.push([])
  }

  if (p.facilities.length) {
    rows.push(['Credit Facilities'])
    rows.push(['Facility', 'Kind', 'Outstanding Balance', 'In "Without" Returns'])
    for (const f of p.facilities) rows.push([f.name, f.kind, f.outstanding, f.inWithoutSeries ? 'Yes' : 'No'])
    rows.push([])
  }

  rows.push(["Detailed Statement of Cash Flows (Cumulative Fee-Paying LPs' Allocation of Total Fund)"])
  rows.push([
    'Effective Date', 'Transaction Description - Granular Methodology', 'Amount - Cumulative LP Allocation',
    'Net - With Facility', 'Gross - With Facility', 'Net - Without Facility', 'Gross - Without Facility', 'TVPI/MOIC Input',
  ])
  for (const f of p.flows) {
    const t = TREATMENT[f.type]
    const role = t.role === 'numerator' ? 'Numerator' : t.role === 'denominator' ? 'Denominator' : 'Decrease Denominator'
    rows.push([f.date, f.type, f.amount, yn(t.withNet), yn(t.withGross), yn(t.withoutNet), yn(t.withoutGross), role])
  }
  rows.push([])

  rows.push(['Totals by Transaction Type'])
  rows.push(['Transaction Type', 'Amount'])
  for (const t of p.totals) rows.push([t.type, t.amount])
  rows.push([])

  rows.push(['Disclosures/Footnotes'])
  for (const n of p.footnotes) rows.push([n])
  return rows
}
