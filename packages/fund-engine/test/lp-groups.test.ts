import { describe, it, expect } from 'vitest'
import { NO_CARRY, type VehicleCarryTerms } from '../src/carry.ts'
import { splitDistribution } from '../src/distribution-waterfall.ts'
import { groupLpsByTerms, groupedClawback } from '../src/lp-groups.ts'

const GP = 'gp'
const straight = (rate = 0.2): VehicleCarryTerms => ({
  ...NO_CARRY, kind: 'straight', carryRate: rate, gpEntityId: GP, recipients: [{ lpEntityId: GP, pct: 100 }],
})
const partner = (lpEntityId: string, contributed: number) => ({ lpEntityId, contributed, ending: contributed, distributed: 0 })
const contributions = [
  { lpEntityId: 'lp-a', date: '2026-01-01', amount: 60_000 },
  { lpEntityId: 'lp-b', date: '2026-01-01', amount: 40_000 },
]

describe('groupLpsByTerms', () => {
  it('puts every LP on the fund terms in one group', () => {
    const groups = groupLpsByTerms({ fundTerms: straight(), lpEntityIds: ['lp-a', 'lp-b'], contributions })
    expect(groups).toHaveLength(1)
    expect(groups[0].lpEntityIds).toEqual(['lp-a', 'lp-b'])
  })

  it('gives an LP on its own terms a group of its own, with the fund recipients', () => {
    const own = { ...straight(0.1), recipients: [] }
    const groups = groupLpsByTerms({ fundTerms: straight(), lpEntityIds: ['lp-a', 'lp-b'], lpTerms: [{ lpEntityId: 'lp-b', terms: own }], contributions })
    expect(groups.map(g => g.lpEntityIds)).toEqual([['lp-a'], ['lp-b']])
    expect(groups[1].terms.recipients).toEqual(straight().recipients)
    expect(groups[1].contributions).toEqual([{ date: '2026-01-01', amount: 40_000 }])
  })
})

describe('splitDistribution with groups', () => {
  const base = {
    partners: [partner('lp-a', 60_000), partner('lp-b', 40_000)],
    contributions: contributions.map(({ lpEntityId: _l, ...c }) => c),
    priors: [],
    asOf: '2027-01-01',
  }

  it('matches the ungrouped split when every LP is on the fund terms', () => {
    const groups = groupLpsByTerms({ fundTerms: straight(), lpEntityIds: ['lp-a', 'lp-b'], contributions })
    const plain = splitDistribution({ ...base, total: 200_000, terms: straight() })
    const split = splitDistribution({ ...base, total: 200_000, terms: straight(), groups })
    expect(split.tiers.toGP).toBe(plain.tiers.toGP)
    expect(split.lines).toEqual(plain.lines)
  })

  it('runs each group on its own carry after return of capital', () => {
    const groups = groupLpsByTerms({ fundTerms: straight(), lpEntityIds: ['lp-a', 'lp-b'], lpTerms: [{ lpEntityId: 'lp-b', terms: straight(0.1) }], contributions })
    const split = splitDistribution({ ...base, total: 200_000, terms: straight(), groups })
    // 100,000 of profit, 60/40 by capital: 20% of 60,000 and 10% of 40,000.
    expect(split.groups!.map(g => g.tiers.toGP)).toEqual([12_000, 4_000])
    expect(split.tiers.toGP).toBe(16_000)
  })

  it('returns senior capital before a subordinated LP gets any', () => {
    const groups = groupLpsByTerms({ fundTerms: straight(), lpEntityIds: ['lp-a', 'lp-b'], lpTerms: [{ lpEntityId: 'lp-b', subordinated: true }], contributions })
    const split = splitDistribution({ ...base, total: 70_000, terms: straight(), groups })
    expect(split.lines).toEqual([{ lpEntityId: 'lp-a', amount: 60_000 }, { lpEntityId: 'lp-b', amount: 10_000 }])
    expect(split.tiers.toGP).toBe(0)
  })
})

describe('groupedClawback', () => {
  it('nets the clawback across groups and pays it back to the overpaid one', () => {
    const groups = groupLpsByTerms({ fundTerms: straight(), lpEntityIds: ['lp-a', 'lp-b'], lpTerms: [{ lpEntityId: 'lp-b', terms: straight(0.1) }], contributions })
    // Carry the replay implies on 200,000 is 16,000; a GP paid 20,000 owes back 4,000.
    const c = groupedClawback([{ date: '2027-01-01', amount: 200_000 }], groups, '2028-01-01', 20_000)
    expect(c.entitlement).toBe(16_000)
    expect(c.amount).toBe(4_000)
  })
})
