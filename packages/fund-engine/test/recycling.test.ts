import { describe, expect, it } from 'vitest'
import { allocateRecycling, recyclingCap, recyclingHeadroom, type RecyclingTerms } from '../src/recycling.ts'

const terms: RecyclingTerms = { capRate: 0.2, capBasis: 'commitments', until: '2030-12-31' }

describe('recycling cap', () => {
  it('is a share of commitments or of fees paid', () => {
    expect(recyclingCap(terms, { commitments: 100_000, managementFees: 15_000 })).toBe(20_000)
    expect(recyclingCap({ ...terms, capBasis: 'management_fees', capRate: 1 }, { commitments: 100_000, managementFees: 15_000 })).toBe(15_000)
    expect(recyclingCap({ ...terms, capRate: 0 }, { commitments: 100_000, managementFees: 15_000 })).toBe(0)
  })

  it('leaves what has not been used, and nothing after the end date', () => {
    const base = { commitments: 100_000, managementFees: 0 }
    expect(recyclingHeadroom(terms, base, 12_500, '2029-06-30')).toBe(7_500)
    expect(recyclingHeadroom(terms, base, 25_000, '2029-06-30')).toBe(0)
    expect(recyclingHeadroom(terms, base, 0, '2031-01-31')).toBe(0)
  })
})

describe('allocateRecycling', () => {
  const events = [
    { at: '2027-03-31', proceeds: 4_000 },
    { at: '2028-03-31', proceeds: 5_000 },
    { at: '2029-03-31', proceeds: 3_000 },
  ]

  it('takes the earliest proceeds when nothing is set', () => {
    expect(allocateRecycling(events, 6_000).map(e => e.recycled)).toEqual([4_000, 2_000, 0])
  })

  it('serves set amounts first, and 0 keeps a distribution out', () => {
    const set = [{ ...events[0], amount: 0 }, events[1], { ...events[2], amount: 2_500 }]
    expect(allocateRecycling(set, 6_000).map(e => e.recycled)).toEqual([0, 3_500, 2_500])
  })

  it('stops at the end date', () => {
    expect(allocateRecycling(events, 20_000, { until: '2028-12-31' }).map(e => e.recycled)).toEqual([4_000, 5_000, 0])
  })

  it('books each distribution its own way', () => {
    const set = [{ ...events[0], treatment: 'deemed' as const }, events[1]]
    expect(allocateRecycling(set, 6_000).map(e => e.deemed)).toEqual([4_000, 0])
    expect(allocateRecycling(set, 6_000, { defaultTreatment: 'deemed' }).map(e => e.deemed)).toEqual([4_000, 2_000])
  })
})
