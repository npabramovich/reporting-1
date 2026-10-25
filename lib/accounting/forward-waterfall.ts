// The waterfall run forward from today's books, for the forecasts.
//
// Both forecasts (construction's yearly schedule and the plan's monthly one) start from the state the
// books show and push projected calls and distributions through the vehicle's waterfall. They used
// to build that state by hand and pass only the carry rate and catch-up rate, so a half-size
// catch-up, a hurdle on unreturned capital, or a deal-by-deal waterfall forecast differently from
// what the accounting engine would book. This keeps them on the same terms as `runWaterfall` and
// `preferredTarget` in the fund engine.
//
// Deal by deal. The forecasts project the fund's cash, not each deal's cost and realization, so an
// American waterfall runs whole fund here and `wholeFundFallback` says so. The ultimate carry is the
// same (the close accrues the whole-fund target for American terms too, carry.ts); what differs is
// when it is paid.

import {
  preferredTarget,
  runWaterfall,
  type DatedContribution,
  type HurdleReduction,
  type WaterfallResult,
  type WaterfallState,
  type WaterfallTerms,
} from '@portfolio/fund-engine'
import { roundCents } from './ledger'
import type { ConstructionWaterfallProjection } from './construction'

export interface ForwardWaterfall {
  terms: WaterfallTerms
  /** True when the terms are deal by deal and the forecast runs them whole fund. */
  wholeFundFallback: boolean
  /** Add an LP contribution (the LPs' share of a call). */
  contribute(date: string, amount: number): void
  /** Run one LP distribution through the waterfall on `date`, and keep the result. */
  distribute(date: string, amount: number): WaterfallResult
  /** The state on `date`: capital contributed so far and the hurdle accrued to then. */
  stateAt(date: string): WaterfallState
}

/** A waterfall to run forward, or null when the projection carries no carry. */
export function forwardWaterfall(p: ConstructionWaterfallProjection): ForwardWaterfall | null {
  if (p.kind === 'none' || !(p.carryRate > 0)) return null
  const straight = p.kind === 'straight'
  const terms: WaterfallTerms = {
    carryRate: p.carryRate,
    catchUpRate: straight ? 1 : p.catchupRate,
    catchUpSize: p.catchupSize ?? 1,
  }
  const prefOn = !straight && p.prefRate > 0
  const unreturned = p.prefBase === 'unreturned'
  const contributions: DatedContribution[] = [...p.contributions]
  const reductions: HurdleReduction[] = []

  const target = (date: string) => prefOn
    ? preferredTarget(contributions, date, p.prefRate, p.prefCompounds, unreturned ? reductions : undefined)
    : 0

  // On the unreturned basis the hurdle stops on capital already returned and pref already paid, so
  // the history has to say what each past distribution returned. The capital and pref tiers go
  // wholly to the LPs, so their net distributions show those two amounts exactly.
  if (unreturned && prefOn) {
    let hist: WaterfallState = { contributedCapital: 0, returnedCapital: 0, preferredPaid: 0, preferredTarget: 0, gpCarryPaid: 0 }
    const sorted = [...(p.distributions ?? [])].filter(d => d.amount > 0).sort((a, b) => a.date.localeCompare(b.date))
    for (const d of sorted) {
      const contributed = roundCents(contributions.filter(c => c.date <= d.date && c.amount > 0).reduce((s, c) => s + c.amount, 0))
      const step = runWaterfall(d.amount, terms, { ...hist, contributedCapital: contributed, preferredTarget: target(d.date) })
      reductions.push({ date: d.date, capital: step.toReturnOfCapital, preferred: step.toPreferred })
      hist = step.state
    }
  }

  let called = p.lpCalledCapital
  const initialPref = target(p.asOf)
  let state: WaterfallState = {
    contributedCapital: called,
    returnedCapital: Math.min(called, p.lpDistributedCapital),
    preferredPaid: Math.min(initialPref, Math.max(0, p.lpDistributedCapital - p.lpCalledCapital)),
    preferredTarget: initialPref,
    gpCarryPaid: Math.max(0, p.fundDistributedCapital - p.lpDistributedCapital),
  }

  const stateAt = (date: string): WaterfallState => ({ ...state, contributedCapital: called, preferredTarget: target(date) })

  return {
    terms,
    wholeFundFallback: p.kind === 'american',
    contribute(date, amount) {
      if (!(amount > 0)) return
      contributions.push({ date, amount })
      called = roundCents(called + amount)
    },
    distribute(date, amount) {
      const result = runWaterfall(amount, terms, stateAt(date))
      state = result.state
      if (result.toReturnOfCapital > 0 || result.toPreferred > 0) {
        reductions.push({ date, capital: result.toReturnOfCapital, preferred: result.toPreferred })
      }
      return result
    },
    stateAt,
  }
}

/** The warning a forecast shows when deal-by-deal terms run whole fund. */
export const WHOLE_FUND_FALLBACK_WARNING =
  'The waterfall is deal by deal, but the forecast projects the fund\'s cash rather than each deal, so it runs the waterfall whole fund. The total carry is the same, but deal by deal the GP may be paid some of it earlier than the forecast shows.'
