import { describe, expect, it } from 'vitest'
import { allocateRecycling, NO_RECYCLING, recyclingCap, recyclingHeadroom, recyclingTermsFromRow, type RecyclingTerms } from '../src/recycling.ts'
import { bucketForSourceType, computeCapitalAccounts, recontributedByLp, rollForwardTies, RECYCLED_PROCEEDS_SOURCE } from '../src/capital-account.ts'

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

describe('recycled proceeds on the capital accounts', () => {
  // One netted entry: each partner's capital is debited (the distribution) and credited (the
  // recontribution) for their share, through the payable. Only the capital legs are here.
  const netted = (lp: string, amount: number, entryDate = '2028-06-30') => [
    { lpEntityId: lp, amount, sourceType: RECYCLED_PROCEEDS_SOURCE, entryDate },
    { lpEntityId: lp, amount: -amount, sourceType: RECYCLED_PROCEEDS_SOURCE, entryDate },
  ]
  const postings = [
    { lpEntityId: 'a', amount: -60_000, sourceType: 'capital_call', entryDate: '2026-01-31' },
    { lpEntityId: 'b', amount: -40_000, sourceType: 'capital_call', entryDate: '2026-01-31' },
    ...netted('a', 6_000),
    ...netted('b', 4_000),
  ]

  it('shows a distribution and a contribution of the same amount, and leaves capital where it was', () => {
    const a = computeCapitalAccounts(postings).get('a')!
    expect(a.contributions).toBe(66_000)
    expect(a.distributions).toBe(-6_000)
    expect(a.ending).toBe(60_000)
    expect(rollForwardTies(a)).toBe(true)
  })

  it('reads the line from the sign: debit is the distribution, credit the recontribution', () => {
    expect(bucketForSourceType(RECYCLED_PROCEEDS_SOURCE, 100)).toBe('distributions')
    expect(bucketForSourceType(RECYCLED_PROCEEDS_SOURCE, -100)).toBe('contributions')
  })

  it('counts the recontribution so uncalled commitment can add it back', () => {
    expect(recontributedByLp(postings)).toEqual(new Map([['a', 6_000], ['b', 4_000]]))
    expect(recontributedByLp(postings, '2027-12-31').size).toBe(0)
  })

  it('reads the terms from the vehicle row, and none when there are none', () => {
    expect(recyclingTermsFromRow(null)).toEqual(NO_RECYCLING)
    expect(recyclingTermsFromRow({ recycle_cap_rate: '0.15', recycle_cap_basis: 'management_fees', recycle_until: '2030-12-31', recycle_default_treatment: 'deemed' }))
      .toEqual({ capRate: 0.15, capBasis: 'management_fees', until: '2030-12-31', uses: 'any', defaultTreatment: 'deemed' })
  })
})
