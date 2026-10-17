// Carried-interest waterfall (European / whole-fund).
//
// A distribution flows through tiers in order:
//   1. Return of capital — to LPs until cumulative distributions = contributed capital
//   2. Preferred return  — to LPs until the accrued hurdle (preferredTarget) is met
//   3. GP catch-up       — catchUpRate of the flow to the GP, the rest to LPs, until the GP's
//                          catch-up reaches catchUpSize of a full catch-up
//   4. Carry split       — remainder split carryRate to GP, the rest to LPs
//
// A catch-up is two terms. Its SIZE is how much of a full catch-up the GP gets, where a full one is
// the carry the GP would have earned on the profit that paid the pref: enough that the GP holds
// carryRate of (preferred + catch-up), i.e. carryRate / (1 − carryRate) of the pref. Its RATE is the
// share of each dollar that goes to the GP while it catches up; the LPs get the rest. Any rate
// works: at 10% on 20% carry the GP takes 10% of the flow until it has its catch-up.
//
// This is a pure function of a distributable amount and the cumulative state, so
// it's fully testable and can be replayed. Hurdle ACCRUAL (how preferredTarget
// grows over time) is supplied by the caller, keeping timing out of the waterfall.

export interface WaterfallTerms {
  /** GP carry share of profits, e.g. 0.20. */
  carryRate: number
  /** The GP's share of each dollar during the catch-up; 1.0 = all of it. */
  catchUpRate?: number
  /** How much of a full catch-up the GP gets, 0–1. Absent means 1, a full catch-up. */
  catchUpSize?: number
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
   * The GP's catch-up paid so far. Absent means all of `gpCarryPaid`, which is exact for a state
   * that has never reached the split.
   */
  gpCatchUpPaid?: number
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

  // 3. GP catch-up: the GP's catch-up totals catchUpSize × c·P'/(1 − c) (a full one leaves it holding
  //    c of pref + catch-up). Of each dollar in this tier it takes catchUpRate and the LPs the rest.
  //    Measured on the GP's catch-up so far, so a later step in the hurdle is caught up in turn.
  const prefAfter = r(state.preferredPaid + toPreferred)
  const gpCatchUpBefore = state.gpCatchUpPaid ?? state.gpCarryPaid
  const size = Math.min(1, Math.max(0, terms.catchUpSize ?? 1))
  let toCatchUp = 0
  let toCatchUpLP = 0
  if (carry > 0 && carry < 1 && catchUpRate > 0 && size > 0) {
    const gpNeeded = r(Math.max(0, (size * carry * prefAfter) / (1 - carry) - gpCatchUpBefore))
    if (gpNeeded > 0) {
      // Round the GP's catch-up, not the gross flow, so a completed catch-up lands to the cent;
      // the LPs' part is what is left of the flow.
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
    gpCatchUpPaid: r(gpCatchUpBefore + toCatchUp),
  }

  return { toReturnOfCapital, toPreferred, toCatchUp, toCatchUpLP, toCarryLP, toCarryGP, toLP, toGP, state: newState }
}
