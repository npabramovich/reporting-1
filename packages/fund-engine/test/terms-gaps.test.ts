import { describe, it, expect } from 'vitest'
import { realizedCapitalFromDeals } from '../src/american-carry.ts'
import { splitDistribution } from '../src/distribution-waterfall.ts'
import { carryAccrual } from '../src/carry.ts'
import { carryAccrualInputs } from '../src/economics.ts'
import { runWaterfall } from '../src/waterfall.ts'
import type { VehicleCarryTerms } from '../src/carry.ts'
import type { CapitalPosting } from '../src/capital-account.ts'

const american: VehicleCarryTerms = {
  kind: 'american', carryRate: 0.2, prefRate: 0, catchupRate: 1, prefCompounds: true,
  gpEntityId: 'gp', recipients: [{ lpEntityId: 'gp', pct: 100 }],
}
const partners = [
  { lpEntityId: 'lp', contributed: 1_000, distributed: 0, ending: 1_000 },
  { lpEntityId: 'gp', contributed: 0, distributed: 0, ending: 0 },
]
const contributions = [{ date: '2024-01-01', amount: 1_000 }]

describe('the American capital base', () => {
  it('realizes each slice of cost over the investments it came from, scaled to LP capital', () => {
    const base = realizedCapitalFromDeals([
      {
        companyId: 'a',
        investments: [{ date: '2024-01-01', amount: 300 }, { date: '2024-07-01', amount: 100 }],
        realizations: [{ date: '2025-01-01', costExited: 200 }, { date: '2025-06-01', costExited: null }],
      },
    ], { factor: 1.1 })
    // Half the basis leaves first, then (no cost stated) the rest: each split 3:1 by investment.
    expect(base).toEqual([
      { companyId: 'a', date: '2024-01-01', realizedOn: '2025-01-01', amount: 165 },
      { companyId: 'a', date: '2024-07-01', realizedOn: '2025-01-01', amount: 55 },
      { companyId: 'a', date: '2024-01-01', realizedOn: '2025-06-01', amount: 165 },
      { companyId: 'a', date: '2024-07-01', realizedOn: '2025-06-01', amount: 55 },
    ])
  })

  it('realizes a deal closed by status alone on its closing date, and never more than its basis', () => {
    const base = realizedCapitalFromDeals([
      { companyId: 'w', investments: [{ date: '2024-01-01', amount: 200 }], realizations: [{ date: '2025-01-01', costExited: 500 }], closedOn: null },
      { companyId: 'x', investments: [{ date: '2024-01-01', amount: 100 }], realizations: [], closedOn: '2025-03-01' },
      { companyId: 'held', investments: [{ date: '2024-01-01', amount: 100 }], realizations: [] },
    ], { factor: 1 })
    expect(base).toEqual([
      { companyId: 'w', date: '2024-01-01', realizedOn: '2025-01-01', amount: 200 },
      { companyId: 'x', date: '2024-01-01', realizedOn: '2025-03-01', amount: 100 },
    ])
  })

  it('pays carry on a winner once the realized deals, losers included, are back', () => {
    const realizedCapital = [
      { date: '2024-01-01', realizedOn: '2025-01-01', amount: 200 }, // written off
      { date: '2024-01-01', realizedOn: '2025-06-01', amount: 300 }, // sold, this distribution
    ]
    const s = splitDistribution({ total: 900, terms: american, partners, contributions, priors: [], asOf: '2025-06-01', realizedCapital })
    expect(s.tiers.returnOfCapital).toBe(500)
    expect(s.tiers.toGP).toBe(80) // 20% of the 400 above the realized 500
    expect(s.warnings).toEqual([])
    // The same distribution whole-fund owes back all 1,000 first: no carry yet.
    const whole = splitDistribution({ total: 900, terms: { ...american, kind: 'european' }, partners, contributions, priors: [], asOf: '2025-06-01' })
    expect(whole.tiers.toGP).toBe(0)
  })

  it('says so when it has no deals, or no deal has realized', () => {
    const none = splitDistribution({ total: 100, terms: american, partners, contributions, priors: [], asOf: '2025-06-01' })
    expect(none.warnings.join(' ')).toMatch(/no realized deals were supplied/)
    const early = splitDistribution({ total: 100, terms: american, partners, contributions, priors: [], asOf: '2025-06-01', realizedCapital: [] })
    expect(early.warnings.join(' ')).toMatch(/No deal has been realized yet/)
  })
})

describe('the close measures carry gross of carry', () => {
  const terms: VehicleCarryTerms = { ...american, kind: 'european' }
  const postings: CapitalPosting[] = [
    { lpEntityId: 'lp', amount: -1_000, sourceType: 'capital_call', entryDate: '2024-01-01' },
    { lpEntityId: 'lp', amount: -500, sourceType: 'unrealized_gain', entryDate: '2024-12-31' },
  ]
  it('posts nothing on a second close of unchanged books, and does not re-accrue carry paid', () => {
    const first = carryAccrualInputs(postings, terms.recipients, '2024-12-31')
    const a1 = carryAccrual({ ...first, asOf: '2024-12-31' }, terms, first.alreadyAccrued)
    expect(a1.delta).toBe(100)
    const booked: CapitalPosting[] = [
      ...postings,
      { lpEntityId: 'lp', amount: 100, sourceType: 'carried_interest', entryDate: '2024-12-31' },
      { lpEntityId: 'gp', amount: -100, sourceType: 'carried_interest', entryDate: '2024-12-31' },
    ]
    const second = carryAccrualInputs(booked, terms.recipients, '2024-12-31')
    expect(carryAccrual({ ...second, asOf: '2024-12-31' }, terms, second.alreadyAccrued).delta).toBe(0)
    // Paying 60 of it to the GP leaves the entitlement where it was.
    const paid = [...booked, { lpEntityId: 'gp', amount: 60, sourceType: 'carry_distribution', entryDate: '2025-01-15' }]
    const third = carryAccrualInputs(paid, terms.recipients, '2025-01-31')
    expect(third.alreadyAccrued).toBe(100)
  })
})

describe('the catch-up', () => {
  it('gives the GP exactly its share once complete, whatever the catch-up rate', () => {
    for (const k of [1, 0.8, 0.5]) {
      const r = runWaterfall(2_000, { carryRate: 0.2, catchUpRate: k }, {
        contributedCapital: 1_000, returnedCapital: 0, preferredPaid: 0, preferredTarget: 80, gpCarryPaid: 0,
      })
      expect(r.toGP, `k=${k}`).toBe(200) // 20% of the 1,000 of profit
    }
  })
})
