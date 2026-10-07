import { describe, it, expect } from 'vitest'
import { tieOutState } from './tie-out-state'

// The schedule's tie-out, once marks post on record and purchases post on match: booked, or
// waiting on bank matches. The warning is left for what derivation cannot explain.
describe('tieOutState', () => {
  it('is booked when cost and fair value tie', () => {
    expect(tieOutState({ tied: true, awaitingCash: 0, costVariance: 0 })).toBe('booked')
  })

  it('is awaiting bank match when the waiting entries cover the cost gap — not a disagreement', () => {
    expect(tieOutState({ tied: false, awaitingCash: 1_000_000, costVariance: 1_000_000 })).toBe('awaiting-match')
  })

  it('warns when nothing is waiting', () => {
    expect(tieOutState({ tied: false, awaitingCash: 0, costVariance: 500 })).toBe('disagrees')
  })

  it('warns when a small wait cannot explain a large gap — history never derived, say', () => {
    expect(tieOutState({ tied: false, awaitingCash: 10_000, costVariance: -5_000_000 })).toBe('disagrees')
  })

  it('says booked even with stray waiting entries once the totals tie', () => {
    expect(tieOutState({ tied: true, awaitingCash: 2_000, costVariance: 0 })).toBe('booked')
  })
})
