// Carried-interest waterfall (European / whole-fund).
//
// A distribution flows through tiers in order:
//   1. Return of capital — to LPs until cumulative distributions = contributed capital
//   2. Preferred return  — to LPs until the accrued hurdle (preferredTarget) is met
//   3. GP catch-up       — catchUpRate of the flow to the GP, the rest to LPs, until the GP holds
//                          carryRate of every profit dollar distributed so far
//   4. Carry split       — remainder split carryRate to GP, the rest to LPs
//
// This is a pure function of a distributable amount and the cumulative state, so
// it's fully testable and can be replayed. Hurdle ACCRUAL (how preferredTarget
// grows over time) is supplied by the caller, keeping timing out of the waterfall.

export interface WaterfallTerms {
  /** GP carry share of profits, e.g. 0.20. */
  carryRate: number
  /** GP share during the catch-up tier; 1.0 = full 100% catch-up. */
  catchUpRate?: number
}

export interface WaterfallState {
  /** Total LP capital contributed — the return-of-capital target. */
  contributedCapital: number
  /** Distributions already returned to LPs as return of capital. */
  returnedCapital: number
  /** Preferred already paid to LPs. */
  preferredPaid: number
  /** Total preferred owed to date (accrued hurdle) — supplied by the caller. */
  preferredTarget: number
  /** Carry already paid to the GP. */
  gpCarryPaid: number
  /**
   * Profit already paid to LPs beyond the preferred return: their share of the catch-up flow and of
   * the split. The catch-up is measured against ALL profit distributed, so it needs this. Absent
   * means 0, which is exact for a state that has never reached the catch-up.
   */
  lpProfitPaid?: number
}

export interface WaterfallResult {
  toReturnOfCapital: number
  toPreferred: number
  /** The GP's part of the catch-up flow. */
  toCatchUp: number
  /** The LPs' part of the catch-up flow: 1 − catchUpRate of it. 0 for a full catch-up. */
  toCatchUpLP: number
  toCarryLP: number
  toCarryGP: number
  toLP: number
  toGP: number
  state: WaterfallState
}

function r(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/** Run one distribution of `distributable` through the waterfall. */
export function runWaterfall(
  distributable: number,
  terms: WaterfallTerms,
  state: WaterfallState
): WaterfallResult {
  const carry = terms.carryRate
  const catchUpRate = terms.catchUpRate ?? 1.0
  let remaining = r(Math.max(0, distributable))

  const take = (want: number): number => {
    const amt = r(Math.max(0, Math.min(remaining, want)))
    remaining = r(remaining - amt)
    return amt
  }

  // 1. Return of capital
  const toReturnOfCapital = take(state.contributedCapital - state.returnedCapital)

  // 2. Preferred return
  const toPreferred = take(state.preferredTarget - state.preferredPaid)

  // 3. GP catch-up. Of every dollar in this tier the GP takes catchUpRate (k) and the LPs the rest,
  //    until the GP holds carryRate (c) of all the profit distributed so far. Profit so far is the
  //    preferred return plus everything the GP has taken plus the LPs' profit beyond the pref, so
  //    a gross catch-up flow x closes the gap when  G + k·x = c·(Π + x),  i.e.
  //    x = (c·Π − G) / (k − c). A catch-up rate at or below the carry rate never closes the gap,
  //    so it is no catch-up at all.
  const prefAfter = r(state.preferredPaid + toPreferred)
  const lpProfitBefore = state.lpProfitPaid ?? 0
  let toCatchUp = 0
  let toCatchUpLP = 0
  if (carry > 0 && carry < 1 && catchUpRate > carry) {
    const profitSoFar = prefAfter + state.gpCarryPaid + lpProfitBefore
    const gap = carry * profitSoFar - state.gpCarryPaid
    if (gap > 0) {
      // Round the GP's catch-up, not the gross flow, so a completed catch-up lands the GP on its
      // share to the cent; the LPs' part is what is left of the flow.
      const gpNeeded = r((catchUpRate * gap) / (catchUpRate - carry))
      const want = r(gpNeeded / catchUpRate)
      const gross = take(want)
      toCatchUp = gross === want ? gpNeeded : r(gross * catchUpRate)
      toCatchUpLP = r(gross - toCatchUp)
    }
  }

  // 4. Carry split on the remainder
  const toCarryGP = r(remaining * carry)
  const toCarryLP = r(remaining - toCarryGP)
  remaining = 0

  const toLP = r(toReturnOfCapital + toPreferred + toCatchUpLP + toCarryLP)
  const toGP = r(toCatchUp + toCarryGP)

  const newState: WaterfallState = {
    contributedCapital: state.contributedCapital,
    returnedCapital: r(state.returnedCapital + toReturnOfCapital),
    preferredPaid: prefAfter,
    preferredTarget: state.preferredTarget,
    gpCarryPaid: r(state.gpCarryPaid + toGP),
    lpProfitPaid: r(lpProfitBefore + toCatchUpLP + toCarryLP),
  }

  return { toReturnOfCapital, toPreferred, toCatchUp, toCatchUpLP, toCarryLP, toCarryGP, toLP, toGP, state: newState }
}
