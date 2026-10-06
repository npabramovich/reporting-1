import { describe, expect, it } from 'vitest'
import { matchQbLp } from './match-lp'
const targets = [
  { entityId: 'a', accountId: 'capital-a', name: 'Paul Sethi' },
  { entityId: 'b', accountId: 'capital-b', name: 'Hardip K. Sethi and Paul A. Sethi' },
  { entityId: 'c', accountId: 'capital-c', name: 'Polaris Capital, LLC' },
]
describe('QuickBooks LP attribution', () => {
  it('uses an exact counterparty despite a different sender in the memo', () => {
    expect(matchQbLp(['Polaris Capital LLC'], ['Sender Paul Sethi'], targets)?.entityId).toBe('c')
  })
  it('finds a full name in a bank memo when Name is absent', () => {
    expect(matchQbLp([], ['WIRE TD AMERITRADE PAUL SETHI'], targets)?.entityId).toBe('a')
  })
  it('holds unknown counterparties, multiple LPs, and partial names for review', () => {
    expect(matchQbLp(['Other investor'], ['Paul Sethi'], targets)).toBeNull()
    expect(matchQbLp([], ['Paul Sethi or Polaris Capital LLC'], targets)).toBeNull()
    expect(matchQbLp([], ['SETHI'], targets)).toBeNull()
    expect(matchQbLp([], ['Paul Sethi'], [])).toBeNull()
  })
  it('refuses duplicate normalized registrations', () => {
    expect(matchQbLp(['Paul Sethi'], [], [...targets, { ...targets[0], entityId: 'duplicate' }])).toBeNull()
  })
})
