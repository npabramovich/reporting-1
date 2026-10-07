// The schedule of investments' tie-out, as an exception report.
//
// Marks post on record and cash entries post on their bank match (plans/spec-books-follow-
// investments.md), so a schedule that does not tie is normally one waiting on bank matches — a
// queue with an obvious next step, not two systems disagreeing. `disagrees` is left for what that
// cannot explain: an entry edited by hand after it was derived, or history never derived at all.
export type TieOutState = 'booked' | 'awaiting-match' | 'disagrees'

export function tieOutState({ tied, awaitingCash, costVariance }: {
  tied: boolean
  /** Total cash (absolute) of the derived entries still waiting for their bank match. */
  awaitingCash: number
  costVariance: number
}): TieOutState {
  if (tied) return 'booked'
  // Waiting entries explain the gap only if they are big enough to. One $10k purchase waiting does
  // not explain $5m of history that never reached the ledger — that is still a disagreement.
  return awaitingCash > 0 && awaitingCash + 0.005 >= Math.abs(costVariance) ? 'awaiting-match' : 'disagrees'
}
