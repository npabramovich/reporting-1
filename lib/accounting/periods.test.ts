import { describe, it, expect } from 'vitest'
import { dateInAnyClosedPeriod } from './periods'

describe('dateInAnyClosedPeriod', () => {
  const closed = [
    { period_start: '2022-01-01', period_end: '2022-12-31' },
    { period_start: '2023-01-01', period_end: '2023-03-31' },
  ]

  it('detects a date inside a closed period (inclusive of the bounds)', () => {
    expect(dateInAnyClosedPeriod(closed, '2022-06-30')).toBe(true)
    expect(dateInAnyClosedPeriod(closed, '2022-01-01')).toBe(true)
    expect(dateInAnyClosedPeriod(closed, '2022-12-31')).toBe(true)
    expect(dateInAnyClosedPeriod(closed, '2023-02-15')).toBe(true)
  })

  it('allows dates outside every closed period', () => {
    expect(dateInAnyClosedPeriod(closed, '2021-12-31')).toBe(false)
    expect(dateInAnyClosedPeriod(closed, '2023-04-01')).toBe(false)
    expect(dateInAnyClosedPeriod([], '2022-06-30')).toBe(false)
  })
})
