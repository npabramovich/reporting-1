// Recycling: proceeds the fund puts back to work instead of distributing.
//
// An LPA caps recycling (a share of commitments, or of the management fees paid), often stops it
// at a date (the end of the investment period), and says what it may fund. Within those limits
// each distribution can be recycled in part, in whole or not at all, and each recycled dollar is
// booked one of two ways:
//
//   * `retained` — never distributed. The fund keeps the cash and calls that much less later, so
//     called capital and distributions are both lower. The default, because it is the common
//     reading of a recycling clause.
//   * `deemed` — distributed to the partners and recontributed. The partners' capital accounts
//     show a distribution and a contribution of the same amount on the same date, and because the
//     distribution is recallable their unfunded commitment goes back up by it. Cash is the same
//     either way. The distribution is a return of the capital recontributed with it, so it never
//     reaches the hurdle or carry tiers.
//
// `allocateRecycling` decides how much of each proceeds event is recycled: events that name an
// amount are served first, in date order, then the rest of the cap comes from the earliest events
// that name none. An event with amount 0 is kept out. Nothing after `until` is recycled.

import { roundCents } from './ledger.ts'

export type RecyclingTreatment = 'retained' | 'deemed'

/** What a recycling cap is a share of. */
export type RecyclingCapBasis = 'commitments' | 'management_fees'

/** What recycled proceeds may pay for. */
export type RecyclingUses = 'any' | 'new_investments' | 'follow_ons'

/** The fund's recycling terms, from the LPA. */
export interface RecyclingTerms {
  /** The cap as a share of `capBasis` (0.2 = 20%). 0 = the fund does not recycle. */
  capRate: number
  capBasis: RecyclingCapBasis
  /** YYYY-MM-DD: proceeds received after this date are not recycled. Null = no end date. */
  until?: string | null
  uses?: RecyclingUses
  /** How a recycled distribution is booked when it does not say. */
  defaultTreatment?: RecyclingTreatment
}

/** The cap in currency: `capRate` × total commitments, or × management fees paid to date. */
export function recyclingCap(terms: RecyclingTerms, base: { commitments: number; managementFees: number }): number {
  if (!(terms.capRate > 0)) return 0
  const of = terms.capBasis === 'management_fees' ? base.managementFees : base.commitments
  return roundCents(Math.max(0, of) * terms.capRate)
}

/** How much more may be recycled on `date`, given what has been recycled so far. */
export function recyclingHeadroom(
  terms: RecyclingTerms,
  base: { commitments: number; managementFees: number },
  recycledToDate: number,
  date: string,
): number {
  if (terms.until && date > terms.until) return 0
  return roundCents(Math.max(0, recyclingCap(terms, base) - recycledToDate))
}

/** One distribution (or forecast exit) that could be recycled. */
export interface RecyclingEvent {
  /** Sorts the events; any comparable string (a YYYY-MM-DD date) or number (years from now). */
  at: string | number
  /** Proceeds available. */
  proceeds: number
  /** Most to recycle from this event. 0 keeps it out; absent = automatic. */
  amount?: number
  treatment?: RecyclingTreatment
}

export interface RecycledEvent {
  recycled: number
  /** The part of `recycled` booked as distributed and recontributed. */
  deemed: number
}

/**
 * How much of each event is recycled, in the order given back. `budget` is the cap left to use;
 * `until`, comparable with `at`, stops recycling after it.
 */
export function allocateRecycling(
  events: RecyclingEvent[],
  budget: number,
  opts: { until?: string | number | null; defaultTreatment?: RecyclingTreatment } = {},
): RecycledEvent[] {
  const order = events.map((e, i) => i).sort((a, b) => (events[a].at < events[b].at ? -1 : events[a].at > events[b].at ? 1 : a - b))
  const open = (e: RecyclingEvent) => opts.until == null || e.at <= opts.until
  const recycled = events.map(() => 0)
  let remaining = Math.max(0, budget)
  for (const i of order) {
    const e = events[i]
    if (e.amount === undefined || !open(e)) continue
    const take = roundCents(Math.max(0, Math.min(e.amount, e.proceeds, remaining)))
    recycled[i] = take
    remaining = roundCents(remaining - take)
  }
  for (const i of order) {
    const e = events[i]
    if (remaining <= 0) break
    if (e.amount !== undefined || !open(e) || !(e.proceeds > 0)) continue
    const take = roundCents(Math.min(e.proceeds, remaining))
    recycled[i] = take
    remaining = roundCents(remaining - take)
  }
  const fallback = opts.defaultTreatment ?? 'retained'
  return events.map((e, i) => ({
    recycled: recycled[i],
    deemed: (e.treatment ?? fallback) === 'deemed' ? recycled[i] : 0,
  }))
}
