// The schedule of investments' tie-out, as an exception report.
//
// Marks post on record and cash entries post on their bank match (plans/spec-books-follow-
// investments.md), so a schedule that does not tie is normally one waiting on bank matches — a
// queue with an obvious next step, not two systems disagreeing. `disagrees` is left for what that
// cannot explain: an entry edited by hand after it was derived, or history never derived at all.
export type TieOutState = 'booked' | 'awaiting-match' | 'disagrees'

export function tieOutState({ tied, awaitingMatch }: { tied: boolean; awaitingMatch: number }): TieOutState {
  if (tied) return 'booked'
  return awaitingMatch > 0 ? 'awaiting-match' : 'disagrees'
}
