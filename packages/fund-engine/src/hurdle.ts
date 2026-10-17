// The preferred return (hurdle): how much LPs are owed on their capital as at a date.
//
// Two bases, because LPAs say two different things:
//   'contributed' — the hurdle accrues on every contribution from the day it was wired, and capital
//                   coming back does not stop it. Simple, and the engine's original reading.
//   'unreturned'  — the hurdle accrues only on capital not yet returned, and (when it compounds) on
//                   preferred return accrued but not yet paid. The more common LPA wording: "8% per
//                   annum, compounded annually, on unreturned capital contributions".
//
// Under 'unreturned' the base shrinks as the waterfall returns capital and pays the pref, so the
// accrual depends on the distribution history; the caller passes what each prior distribution
// returned and paid (the replay in replay.ts works that out from the waterfall itself).

import { roundCents } from './ledger.ts'

/** A dated contribution, for accruing the preferred return. */
export interface DatedContribution {
  date: string
  amount: number
}

/** What one distribution returned and paid, which shrinks an 'unreturned' hurdle base. */
export interface HurdleReduction {
  date: string
  /** Capital returned (the return-of-capital tier). */
  capital: number
  /** Preferred return paid (the preferred tier). */
  preferred: number
}

export type PrefBase = 'contributed' | 'unreturned'

// ACTUAL/365, the usual convention in an LPA. Using 365.25 would make "one year" 0.9993 of a year
// and quietly understate the hurdle — small, but it compounds, and it is the kind of difference an
// LP's accountant will find.
const YEAR_MS = 365 * 24 * 60 * 60 * 1000

/**
 * The cumulative preferred return accrued as at `asOf`.
 *
 * With no `reductions` this is the 'contributed' basis: each contribution accrues from the day it
 * was made — money committed on paper earns nothing; money actually WIRED does.
 *
 * With `reductions` it is the 'unreturned' basis: capital returned stops accruing from the day it
 * comes back, and (compounding) preferred paid stops compounding. The result is still CUMULATIVE —
 * everything accrued to date, paid or not — because the waterfall compares it with the cumulative
 * preferred paid.
 */
export function preferredTarget(
  contributions: DatedContribution[],
  asOf: string,
  rate: number,
  compounds: boolean,
  reductions?: HurdleReduction[],
): number {
  if (rate <= 0) return 0

  const end = Date.parse(asOf)
  if (Number.isNaN(end)) return 0

  if (!reductions || reductions.length === 0) {
    let total = 0
    for (const c of contributions) {
      const start = Date.parse(c.date)
      if (Number.isNaN(start) || start >= end || c.amount <= 0) continue
      const years = (end - start) / YEAR_MS
      total += compounds
        ? c.amount * (Math.pow(1 + rate, years) - 1)
        : c.amount * rate * years
    }
    return roundCents(total)
  }

  // The balance method: walk the dated events, accruing between them on what is outstanding.
  // On one date, contributions land before reductions, so a same-day call and return net out.
  type Event = { t: number; order: number; capital: number; preferred: number }
  const events: Event[] = []
  for (const c of contributions) {
    const t = Date.parse(c.date)
    if (Number.isNaN(t) || t >= end || c.amount <= 0) continue
    events.push({ t, order: 0, capital: c.amount, preferred: 0 })
  }
  for (const d of reductions) {
    const t = Date.parse(d.date)
    if (Number.isNaN(t) || t >= end) continue
    events.push({ t, order: 1, capital: -Math.max(0, d.capital), preferred: Math.max(0, d.preferred) })
  }
  events.sort((a, b) => a.t - b.t || a.order - b.order)

  let capital = 0 // unreturned capital
  let unpaid = 0 // preferred accrued and not yet paid
  let accrued = 0 // cumulative preferred accrued
  let at = events.length > 0 ? events[0].t : end
  const accrueTo = (t: number) => {
    if (t <= at) return
    const years = (t - at) / YEAR_MS
    const growth = compounds
      ? (capital + unpaid) * (Math.pow(1 + rate, years) - 1)
      : capital * rate * years
    accrued += growth
    unpaid += growth
    at = t
  }
  for (const e of events) {
    accrueTo(e.t)
    capital = Math.max(0, capital + e.capital)
    unpaid = Math.max(0, unpaid - e.preferred)
  }
  accrueTo(end)
  return roundCents(accrued)
}
