// Capital management — calls and distributions — month by month (plans/plan-unified-plan.md §1.4).
//
// Portfolio construction says what the investments do (checks written, exit proceeds). The fund
// forecast decides what the fund does with the money:
//
//   calls          keep cash at or above `calls.reserve`: a month that would end below it calls the
//                  shortfall, up to what remains uncalled.
//   distributions  pay out exit proceeds `distributions.lagMonths` after they arrive, keeping
//                  `distributions.reserve` in the bank.
//
// Any month can be set by hand (`calls[month]`, `distributions[month]`), which overrides the policy
// for that month only. The waterfall then runs on the distributions actually made: the LPs' share of
// each is split between the LPs and the GP's carry; the GP entity's own stake is paid in full.
//
// Pure: the service supplies cash flows, opening cash, the uncalled amount and the waterfall state.

import { roundCents } from '@/lib/accounting/ledger'
import type { WaterfallState, WaterfallTerms } from '@/lib/accounting/waterfall'
import { forwardWaterfall, WHOLE_FUND_FALLBACK_WARNING } from '@/lib/accounting/forward-waterfall'
import type { ConstructionWaterfallProjection } from '@/lib/accounting/construction'
import { isMonthKey, lastDay, type MonthKey } from './months'
import { MAX_AMOUNT, MAX_RULE_ITEMS } from './rules'

export interface CapitalPolicy {
  calls: { reserve: number }
  distributions: { lagMonths: number; reserve: number }
}

export interface CapitalSettings {
  policy: CapitalPolicy
  /** Month edits: what to call, or distribute, that month (overrides the policy). */
  calls: Record<string, number>
  distributions: Record<string, number>
}

export const DEFAULT_CAPITAL: CapitalSettings = {
  policy: { calls: { reserve: 0 }, distributions: { lagMonths: 0, reserve: 0 } },
  calls: {},
  distributions: {},
}

export class CapitalError extends Error {}

export function validateCapital(raw: unknown): CapitalSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>
  // Amounts are bounded (MAX_AMOUNT) so nothing compiled from them can overflow the ledger's
  // numeric(20,2) or reach Infinity.
  const num = (v: unknown, field: string, min = 0, max = MAX_AMOUNT) => {
    const n = v == null || v === '' ? 0 : Number(v)
    if (!Number.isFinite(n) || n < min || n > max) throw new CapitalError(`${field} must be a number from ${min} to ${max.toLocaleString('en-US')}`)
    return n
  }
  const months = (o: unknown, field: string) => {
    const out: Record<string, number> = {}
    const entries = Object.entries((o && typeof o === 'object' ? o : {}) as Record<string, unknown>)
    if (entries.length > MAX_RULE_ITEMS) throw new CapitalError(`${field} has too many months (at most ${MAX_RULE_ITEMS})`)
    for (const [m, v] of entries) {
      if (!isMonthKey(m)) throw new CapitalError(`${field} months must be YYYY-MM`)
      out[m] = roundCents(num(v, `${field} ${m}`))
    }
    return out
  }
  return {
    policy: {
      calls: { reserve: roundCents(num(r.policy?.calls?.reserve, 'The cash reserve')) },
      distributions: {
        lagMonths: Math.round(num(r.policy?.distributions?.lagMonths, 'The payout lag', 0, 36)),
        reserve: roundCents(num(r.policy?.distributions?.reserve, 'The distribution reserve')),
      },
    },
    calls: months(r.calls, 'Calls'),
    distributions: months(r.distributions, 'Distributions'),
  }
}

export interface CapitalResult {
  calls: Map<MonthKey, number>
  distributions: Map<MonthKey, number>
  endingCash: Map<MonthKey, number>
  warnings: string[]
}

/**
 * Calls and distributions by month. `cashFlows` is every other cash movement in the month (fees,
 * expenses, checks written, exit proceeds, hand entries); `proceeds` is the exit proceeds within it
 * (what the distribution policy pays out).
 */
export function computeCapital(input: {
  months: MonthKey[]
  openingCash: number
  cashFlows: Map<MonthKey, number>
  proceeds: Map<MonthKey, number>
  uncalled: number
  settings: CapitalSettings
}): CapitalResult {
  const { policy } = input.settings
  const calls = new Map<MonthKey, number>()
  const distributions = new Map<MonthKey, number>()
  const endingCash = new Map<MonthKey, number>()
  const warnings: string[] = []
  let cash = roundCents(input.openingCash)
  let uncalled = Math.max(0, roundCents(input.uncalled))
  let owed = 0 // proceeds due to be distributed and not yet paid
  let shortfall = 0

  input.months.forEach((m, i) => {
    cash = roundCents(cash + (input.cashFlows.get(m) ?? 0))
    // Proceeds become payable `lagMonths` after they arrive.
    const dueFrom = input.months[i - policy.distributions.lagMonths]
    if (dueFrom) owed = roundCents(owed + (input.proceeds.get(dueFrom) ?? 0))

    // Call first, so a month's investments are funded before anything is paid out.
    let call = 0
    if (input.settings.calls[m] != null) {
      call = input.settings.calls[m]
      if (call > uncalled + 0.005) warnings.push(`The call in ${m} is more than the ${uncalled.toLocaleString('en-US')} still uncalled`)
    } else if (cash < policy.calls.reserve) {
      call = Math.min(roundCents(policy.calls.reserve - cash), uncalled)
      if (call < roundCents(policy.calls.reserve - cash)) shortfall++
    }
    call = roundCents(call)
    uncalled = Math.max(0, roundCents(uncalled - call))
    cash = roundCents(cash + call)

    let dist = 0
    if (input.settings.distributions[m] != null) {
      dist = input.settings.distributions[m]
      owed = Math.max(0, roundCents(owed - dist))
    } else if (owed > 0) {
      dist = Math.max(0, Math.min(owed, roundCents(cash - policy.distributions.reserve)))
      owed = roundCents(owed - dist)
    }
    dist = roundCents(dist)
    cash = roundCents(cash - dist)

    if (call) calls.set(m, call)
    if (dist) distributions.set(m, dist)
    endingCash.set(m, cash)
  })
  if (shortfall) warnings.push(`In ${shortfall} month${shortfall === 1 ? '' : 's'} cash falls below the reserve and the fund has no uncalled capital left to call`)
  if (owed > 0.005) warnings.push(`${roundCents(owed).toLocaleString('en-US')} of exit proceeds is not distributed by the end of the plan`)
  return { calls, distributions, endingCash, warnings }
}

export interface MonthlySplit {
  /** To the LPs (their share, net of carry). */
  toLp: number
  /** To the carry recipients. */
  carry: number
  /** To the GP entity's own stake (no carry on it). */
  toGpStake: number
}

/**
 * Split each month's distribution: the GP's stake gets its share in full; the LPs' share runs
 * through the waterfall (return of capital, preferred, catch-up, carry), from the state the books
 * show today. Without carry terms, everything goes to the partners.
 */
export function splitDistributions(
  distributions: Map<MonthKey, number>,
  calls: Map<MonthKey, number>,
  months: MonthKey[],
  wf: ConstructionWaterfallProjection | undefined,
): Map<MonthKey, MonthlySplit> {
  return runMonthlyWaterfall(distributions, calls, months, wf).byMonth
}

/** As splitDistributions, also returning the waterfall's state at the end (for a liquidation value). */
export function runMonthlyWaterfall(
  distributions: Map<MonthKey, number>,
  calls: Map<MonthKey, number>,
  months: MonthKey[],
  wf: ConstructionWaterfallProjection | undefined,
): { byMonth: Map<MonthKey, MonthlySplit>; state: WaterfallState | null; terms: WaterfallTerms | null; lpShare: number; warnings: string[] } {
  const out = new Map<MonthKey, MonthlySplit>()
  const forward = wf ? forwardWaterfall(wf) : null
  const share = wf ? Math.min(1, Math.max(0, wf.lpCommitmentShare)) : 1
  if (!forward) {
    for (const [m, d] of distributions) out.set(m, { toLp: d, carry: 0, toGpStake: 0 })
    return { byMonth: out, state: null, terms: null, lpShare: share, warnings: [] }
  }
  for (const m of months) {
    const call = calls.get(m) ?? 0
    if (call > 0) forward.contribute(lastDay(m), roundCents(call * share))
    const d = distributions.get(m) ?? 0
    if (!d) continue
    const lpPart = roundCents(d * share)
    const split = forward.distribute(lastDay(m), lpPart)
    out.set(m, { toLp: split.toLP, carry: split.toGP, toGpStake: roundCents(d - lpPart) })
  }
  const last = months[months.length - 1]
  return {
    byMonth: out,
    state: last ? forward.stateAt(lastDay(last)) : forward.stateAt(wf!.asOf),
    terms: forward.terms,
    lpShare: share,
    warnings: forward.wholeFundFallback ? [WHOLE_FUND_FALLBACK_WARNING] : [],
  }
}
