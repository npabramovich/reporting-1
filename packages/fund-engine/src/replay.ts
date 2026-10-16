// Where the waterfall's tiers stand on a date: replay every prior distribution through it.
//
// `runWaterfall` (waterfall.ts) is pure over a cumulative STATE — capital returned so far, preferred
// paid so far, carry paid so far. Nothing stores that state, and it should not be stored: it is a
// function of the distributions that came before. So we REPLAY them. Every prior distribution total,
// in date order, runs through the waterfall with the preferred return accrued to that date, and the
// state it leaves behind is where the next one starts.
//
// The replay is over TOTALS, not over who received what. The LPA defines the tiers on cumulative
// amounts, so the tier state is what the agreement implies given the money that has left the fund.
//
// Two term choices change what the replay measures against:
//   - prefBase 'unreturned': the hurdle stops accruing on capital the replay has returned and on
//     preferred it has paid (hurdle.ts), so each step feeds the next one's hurdle.
//   - kind 'american' with `realizedCapital`: the capital tier covers only capital in deals that
//     have been realized (sold or written off) by that date, plus their share of fees and expenses,
//     and the hurdle accrues only on that capital. That is the deal-by-deal waterfall: carry is
//     paid on a winner once the LPs have their money back on every deal realized so far, losers
//     included — not once the whole fund is returned.

import { runWaterfall, type WaterfallState, type WaterfallTerms } from './waterfall.ts'
import { preferredTarget, type DatedContribution, type HurdleReduction } from './hurdle.ts'
import { roundCents } from './ledger.ts'
import type { VehicleCarryTerms } from './carry.ts'

/** A prior distribution — the fund-wide total that left on that date, carry included. */
export interface PriorDistribution {
  date: string
  amount: number
}

/**
 * LP capital that joins an American waterfall's capital tier when its deal is realized.
 *
 * `date` is when the capital went in (the hurdle accrues from there); `realizedOn` is when the
 * deal was sold or written off (the capital is owed back from there). One deal can contribute
 * several entries: one per investment, scaled to the cost a realization took out.
 */
export interface RealizedCapital {
  companyId?: string
  date: string
  realizedOn: string
  amount: number
}

export interface ReplayOptions {
  /** The American capital base. Ignored unless `terms.kind` is 'american'. */
  realizedCapital?: RealizedCapital[]
}

export function waterfallTermsOf(terms: VehicleCarryTerms): WaterfallTerms {
  // 'straight' is the waterfall with no hurdle: return of capital, then the split. Setting the
  // preferred target to zero makes the catch-up tier vanish on its own (there is nothing to catch
  // up to), which is exactly the straight definition.
  return { carryRate: terms.carryRate, catchUpRate: terms.kind === 'straight' ? 1 : terms.catchupRate }
}

/** Whether the replay measures an American (realized-deals) capital base. */
export function usesRealizedBase(terms: VehicleCarryTerms, opts?: ReplayOptions): boolean {
  return terms.kind === 'american' && Array.isArray(opts?.realizedCapital)
}

/**
 * Replay every prior distribution through the waterfall to find where the tiers stand at `asOf`.
 *
 * `contributions` are the LPs' dated contributions: capital to be returned once it has arrived,
 * and the hurdle's base. Each prior runs with the preferred return accrued to ITS date, so a
 * distribution made before the hurdle had accrued much correctly went mostly to capital.
 */
export function replayWaterfallState(
  priors: PriorDistribution[],
  contributions: DatedContribution[],
  terms: VehicleCarryTerms,
  asOf: string,
  opts?: ReplayOptions,
): WaterfallState {
  const realized = usesRealizedBase(terms, opts)
  const contributedAsOf = (date: string) => contributions.filter(c => c.date <= date && c.amount > 0)
  const capitalAsOf = (date: string): DatedContribution[] => realized
    ? opts!.realizedCapital!.filter(c => c.realizedOn <= date && c.amount > 0).map(c => ({ date: c.date, amount: c.amount }))
    : contributedAsOf(date)
  const total = (cs: DatedContribution[]) => roundCents(cs.reduce((s, c) => s + c.amount, 0))
  // The realized base never owes back more capital than the LPs have actually put in.
  const capitalTotal = (date: string) => realized
    ? Math.min(total(capitalAsOf(date)), total(contributedAsOf(date)))
    : total(capitalAsOf(date))

  const unreturned = terms.prefBase === 'unreturned'
  const reductions: HurdleReduction[] = []
  const target = (date: string): number => {
    if (terms.kind === 'straight') return 0
    return preferredTarget(capitalAsOf(date), date, terms.prefRate, terms.prefCompounds, unreturned ? reductions : undefined)
  }

  let state: WaterfallState = {
    contributedCapital: 0,
    returnedCapital: 0,
    preferredPaid: 0,
    preferredTarget: 0,
    gpCarryPaid: 0,
    lpProfitPaid: 0,
  }
  const sorted = [...priors].filter(p => p.amount > 0 && p.date <= asOf).sort((a, b) => a.date.localeCompare(b.date))
  for (const p of sorted) {
    state = { ...state, contributedCapital: capitalTotal(p.date), preferredTarget: target(p.date) }
    const step = runWaterfall(p.amount, waterfallTermsOf(terms), state)
    reductions.push({ date: p.date, capital: step.toReturnOfCapital, preferred: step.toPreferred })
    state = step.state
  }
  return { ...state, contributedCapital: capitalTotal(asOf), preferredTarget: target(asOf) }
}
