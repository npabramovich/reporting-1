import { describe, it, expect } from 'vitest'
import { tieOutState } from './tie-out-state'

// The schedule's tie-out, once marks post on record and purchases post on match: booked, or
// waiting on bank matches. The warning is left for what derivation cannot explain.
describe('tieOutState', () => {
  it('is booked when cost and fair value tie', () => {
    expect(tieOutState({ tied: true, awaitingMatch: 0 })).toBe('booked')
  })

  it('is awaiting bank match when derived entries still wait — not a disagreement', () => {
    expect(tieOutState({ tied: false, awaitingMatch: 3 })).toBe('awaiting-match')
  })

  it('warns only when nothing waiting explains the gap', () => {
    expect(tieOutState({ tied: false, awaitingMatch: 0 })).toBe('disagrees')
  })

  it('says booked even with stray waiting entries once the totals tie', () => {
    expect(tieOutState({ tied: true, awaitingMatch: 2 })).toBe('booked')
  })
})
