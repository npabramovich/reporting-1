import { describe, it, expect } from 'vitest'
import { earliestPostingDate } from './statement-package'

describe('earliestPostingDate', () => {
  it('returns the min entryDate, ignoring nulls', () => {
    expect(earliestPostingDate([
      { accountId: 'a', amount: 1, entryDate: '2026-03-01' } as any,
      { accountId: 'b', amount: -1, entryDate: '2025-11-15' } as any,
      { accountId: 'c', amount: 0, entryDate: null } as any,
    ])).toBe('2025-11-15')
  })
  it('returns null when there are no dated postings', () => {
    expect(earliestPostingDate([])).toBeNull()
    expect(earliestPostingDate([{ accountId: 'a', amount: 1, entryDate: null } as any])).toBeNull()
  })
})
