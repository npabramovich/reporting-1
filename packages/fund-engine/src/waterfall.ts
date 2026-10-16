// Carried-interest waterfall (European / whole-fund).
//
// A distribution flows through tiers in order:
//   1. Return of capital — to LPs until cumulative distributions = contributed capital
//   2. Preferred return  — to LPs until the accrued hurdle (preferredTarget) is met
//   3. GP catch-up       — to GP until GP holds carryRate of (preferred + catch-up)
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
}

export interface WaterfallResult {
  toReturnOfCapital: number
  toPreferred: number
  toCatchUp: number
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

  // 3. GP catch-up: GP takes catchUpRate of the flow until it holds carry of (pref + catchup).
  //    Target GP catch-up C satisfies (gpCarryPaid + C) = carry × (preferredPaid+toPreferred + C/catchUpRate).
  const prefAfter = r(state.preferredPaid + toPreferred)
  let toCatchUp = 0
  if (carry > 0 && carry < 1) {
    const fullCatchUp = r((carry * prefAfter) / (1 - carry)) // GP total at end of catch-up
    const catchUpNeeded = r(Math.max(0, fullCatchUp - state.gpCarryPaid))
    // The distribution consumed to fund a GP catch-up of X is X / catchUpRate.
    const grossForCatchUp = catchUpRate > 0 ? r(catchUpNeeded / catchUpRate) : 0
    const grossTaken = take(grossForCatchUp)
    toCatchUp = r(grossTaken * catchUpRate)
    // The non-GP portion of the catch-up flow (if catchUpRate < 1) goes to LPs.
    const lpCatchUpShare = r(grossTaken - toCatchUp)
    // Fold the LP portion into the carry-split LP bucket below via `remaining` — it
    // was already removed from `remaining`, so add it back so the split sees it.
    remaining = r(remaining + lpCatchUpShare)
  }

  // 4. Carry split on the remainder
  const toCarryGP = r(remaining * carry)
  const toCarryLP = r(remaining - toCarryGP)
  remaining = 0

  const toLP = r(toReturnOfCapital + toPreferred + toCarryLP)
  const toGP = r(toCatchUp + toCarryGP)

  const newState: WaterfallState = {
    contributedCapital: state.contributedCapital,
    returnedCapital: r(state.returnedCapital + toReturnOfCapital),
    preferredPaid: prefAfter,
    preferredTarget: state.preferredTarget,
    gpCarryPaid: r(state.gpCarryPaid + toGP),
  }

  return { toReturnOfCapital, toPreferred, toCatchUp, toCarryLP, toCarryGP, toLP, toGP, state: newState }
}
