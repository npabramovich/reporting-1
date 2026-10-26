// A dated management fee schedule.
//
// The close charges one rate on one basis for the period it covers (lib/accounting/fees.ts). An
// LPA states the fee on dates: "quarterly in advance, 0.5% of Commitments until the end of the
// Investment Period, then 0.375% of Invested Capital, reduced by 100% of Transaction Fees and by
// Organizational Expenses above $500,000." This runs that wording, the reading the Walter spec
// takes (spec/07-management-fees.md):
//
//   * Periods start on `start` and step by the frequency on the calendar, a month end clamping
//     to the shorter month. `end` cuts the last one.
//   * The step in force on a day is the latest one that has started. A step or `end` inside a
//     period cuts it, and each piece is charged rate ÷ periods per year × the basis on the
//     piece's first day × its days ÷ the period's days.
//   * Bases are the fee-bearing partners' share of commitments, of cost invested and not yet
//     realized before the day, or of the last NAV on or before it.
//   * Portfolio-company fees earn their offset share in the period they're dated in, and
//     organizational expenses above the cap offset dollar for dollar. A period's offset is the
//     smaller of its gross fee and what's available; the rest carries forward.
//
// Each period's gross and offset are rounded to cents, half to even.
//
// Partners on rates of their own are `groups`: each pays its own steps on its own partners' basis,
// the period's gross is the sum, and the offset reduces each group's fee in proportion to its share
// of it (Walter's LP classes, spec/11-lp-classes.md).

export type FeeFrequency = 'quarterly' | 'semiannual' | 'annual'
export type FeeScheduleBasis = 'commitments' | 'invested' | 'nav'

export interface FeeScheduleTerms {
  frequency: FeeFrequency
  /** YYYY-MM-DD. */
  start: string
  /** YYYY-MM-DD, exclusive. */
  end: string
  /** Each step from its date (resolve events to dates first). */
  steps: Array<{ from: string; rate: number; basis: FeeScheduleBasis }>
  /** Share of each kind of portfolio-company fee that offsets the fee. */
  offsets?: Record<string, number>
  /** Organizational expenses above this offset the fee dollar for dollar. */
  organizationalExpenseCap?: number
  /**
   * Partners on rates of their own, each with its steps and its fee-bearing commitments. Given,
   * these replace `steps` and `feeBearingCommitments`, and each period reports `groupNet`.
   */
  groups?: Array<{ steps: FeeScheduleTerms['steps']; feeBearingCommitments: number }>
}

export interface FeeScheduleFacts {
  /** The fee-bearing partners' commitments. */
  feeBearingCommitments: number
  /** Every partner's commitments. */
  allCommitments: number
  investments?: Array<{ date: string; deal: string; amount: number }>
  /** Exits and write-offs; `cost` omitted takes all that's left of the deal. */
  exits?: Array<{ date: string; deal: string; cost?: number }>
  navs?: Array<{ date: string; amount: number }>
  portfolioFees?: Array<{ date: string; kind: string; amount: number }>
  organizationalExpenses?: Array<{ date: string; amount: number }>
}

export interface FeeSchedulePeriod {
  start: string
  end: string
  gross: number
  offset: number
  net: number
  /** Each group's share of `net`, unrounded, when the terms have groups. */
  groupNet?: number[]
}

const MONTHS: Record<FeeFrequency, number> = { quarterly: 3, semiannual: 6, annual: 12 }

const dayNumber = (date: string) => {
  const [y, m, d] = date.split('-').map(Number)
  return Date.UTC(y, m - 1, d) / 86_400_000
}

/** `date` plus whole months, clamped to the month's last day. */
export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const total = y * 12 + (m - 1) + months
  const ny = Math.floor(total / 12)
  const nm = total % 12
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate()
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${pad(ny, 4)}-${pad(nm + 1)}-${pad(Math.min(d, last))}`
}

/** Cents, half to even. */
function cents(v: number): number {
  const c = v * 100
  const f = Math.floor(c)
  return (Math.abs(c - f - 0.5) < 1e-7 ? (f % 2 === 0 ? f : f + 1) : Math.round(c)) / 100
}

export function feeSchedule(terms: FeeScheduleTerms, facts: FeeScheduleFacts): FeeSchedulePeriod[] {
  const step = MONTHS[terms.frequency]
  const perYear = 12 / step
  const groups = (terms.groups ?? [{ steps: terms.steps, feeBearingCommitments: facts.feeBearingCommitments }]).map((g) => ({
    steps: g.steps.slice().sort((a, b) => a.from.localeCompare(b.from)),
    commit: g.feeBearingCommitments,
    share: facts.allCommitments > 0 ? g.feeBearingCommitments / facts.allCommitments : 0,
  }))
  const steps = groups.flatMap((g) => g.steps)

  /** Cost invested before the day, less cost realized before it. */
  const invested = (asOf: string): number => {
    const cost = new Map<string, number>()
    let total = 0
    for (const i of facts.investments ?? []) {
      if (i.date >= asOf) continue
      cost.set(i.deal, (cost.get(i.deal) ?? 0) + i.amount)
      total += i.amount
    }
    const exited = new Map<string, number>()
    for (const e of facts.exits ?? []) {
      if (e.date >= asOf) continue
      const done = exited.get(e.deal) ?? 0
      const left = Math.max(0, (cost.get(e.deal) ?? 0) - done)
      exited.set(e.deal, done + (e.cost === undefined ? left : Math.min(left, e.cost)))
    }
    return Math.max(0, total - [...exited.values()].reduce((s, v) => s + v, 0))
  }
  const nav = (asOf: string): number => {
    let last = 0
    for (const n of facts.navs ?? []) if (n.date <= asOf) last = n.amount
    return last
  }
  const basisOn = (g: (typeof groups)[number], basis: FeeScheduleBasis, day: string) =>
    basis === 'commitments' ? g.commit : (basis === 'invested' ? invested(day) : nav(day)) * g.share

  const orgBefore = (day: string) =>
    (facts.organizationalExpenses ?? []).filter((o) => o.date < day).reduce((s, o) => s + o.amount, 0)
  const offsetsIn = (from: string, to: string): number => {
    let o = 0
    for (const f of facts.portfolioFees ?? []) {
      if (f.date >= from && f.date < to) o += f.amount * (terms.offsets?.[f.kind] ?? 0)
    }
    const cap = terms.organizationalExpenseCap
    if (cap !== undefined) o += Math.max(0, orgBefore(to) - cap) - Math.max(0, orgBefore(from) - cap)
    return o
  }

  const periods: FeeSchedulePeriod[] = []
  let carried = 0
  for (let start = terms.start; start < terms.end; start = addMonths(start, step)) {
    const next = addMonths(start, step)
    const stop = terms.end < next ? terms.end : next
    const days = dayNumber(next) - dayNumber(start)
    const cuts = [start, ...steps.map((s) => s.from).filter((d) => d > start && d < stop), stop]
    const groupGross = groups.map((g) => {
      let gg = 0
      for (let i = 0; i + 1 < cuts.length; i++) {
        const s = [...g.steps].reverse().find((x) => x.from <= cuts[i])
        if (!s) continue
        gg += (s.rate / perYear) * basisOn(g, s.basis, cuts[i]) * ((dayNumber(cuts[i + 1]) - dayNumber(cuts[i])) / days)
      }
      return gg
    })
    const exact = groupGross.reduce((a, b) => a + b, 0)
    const gross = cents(exact)
    const available = carried + offsetsIn(start, stop)
    const offset = cents(Math.min(gross, available))
    carried = available - offset
    const net = cents(gross - offset)
    periods.push({
      start, end: stop, gross, offset, net,
      ...(terms.groups ? { groupNet: groupGross.map((g) => (exact > 0 ? (net * g) / exact : 0)) } : {}),
    })
  }
  return periods
}
