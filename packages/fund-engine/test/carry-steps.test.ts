import { describe, expect, it } from 'vitest'
import {
  carryTarget,
  carryTermsFromRow,
  datedContributions,
  replayWaterfallState,
  runWaterfall,
  splitDistribution,
  type VehicleCarryTerms,
} from '../src/index.ts'

const straight = (over: Partial<VehicleCarryTerms> = {}): VehicleCarryTerms => ({
  kind: 'straight', carryRate: 0.2, prefRate: 0, catchupRate: 1, catchupSize: 1, prefCompounds: true,
  prefBase: 'contributed', gpEntityId: 'gp', recipients: [{ lpEntityId: 'gp', pct: 100 }], ...over,
})

describe('carry that steps up', () => {
  it('runs 20% until the LPs have 2x, then 30%', () => {
    // 1,000 in and 4,000 back: 1,250 at 20% takes the LPs to 2,000, the last 1,750 splits 1,225/525.
    const r = runWaterfall(4000, { carryRate: 0.2, steps: [{ lpMultiple: 2, carryRate: 0.3 }] }, {
      contributedCapital: 1000, returnedCapital: 0, preferredPaid: 0, preferredTarget: 0, gpCarryPaid: 0,
    })
    expect(r.toReturnOfCapital).toBe(1000)
    expect(r.bands).toEqual([
      { carryRate: 0.2, catchUp: 0, catchUpToLP: 0, toLP: 1000, toGP: 250 },
      { carryRate: 0.3, catchUp: 0, catchUpToLP: 0, toLP: 1225, toGP: 525 },
    ])
    expect(r.toGP).toBe(775)
  })

  it('keeps a split going past an IRR step only when the dated cash is supplied', () => {
    const terms = { carryRate: 0.2, steps: [{ lpIrr: 0.1, carryRate: 0.3 }] }
    const base = { contributedCapital: 1000, returnedCapital: 0, preferredPaid: 0, preferredTarget: 0, gpCarryPaid: 0 }
    expect(runWaterfall(3000, terms, base).bands![1].toGP).toBe(0)
    const dated = runWaterfall(3000, terms, {
      ...base,
      irr: { asOf: '2027-01-01', contributions: [{ date: '2025-01-01', amount: 1000 }], lpDistributions: [] },
    })
    // 1,000 × 1.1^2 is what the LPs need, and they need it before the step.
    const need = 1000 * Math.pow(1.1, 2)
    expect(dated.toReturnOfCapital + dated.bands![0].toLP).toBeCloseTo(need, 1)
    expect(dated.bands![1].toGP).toBeGreaterThan(0)
  })

  it('accrues the stepped carry in the close', () => {
    const terms = straight({ carrySteps: [{ lpMultiple: 2, carryRate: 0.3 }] })
    const target = carryTarget({
      lps: [{ lpEntityId: 'lp', contributed: 1000, distributed: 0, nav: 4000 }],
      contributions: [{ date: '2025-01-01', amount: 1000 }],
      asOf: '2030-01-01',
    }, terms)
    expect(target).toBe(775)
  })

  it('reads well-formed steps from the stored row and drops the rest', () => {
    const t = carryTermsFromRow({
      kind: 'european', carry_rate: 0.2,
      carry_steps: [{ lpMultiple: 2, carryRate: 0.25, catchUpRate: 1 }, { carryRate: 0.3 }, { lpIrr: 0.2, lpMultiple: 3, carryRate: 0.3 }],
    })
    expect(t.carrySteps).toEqual([{ lpMultiple: 2, carryRate: 0.25, catchUpRate: 1 }])
  })
})

describe('capital that leaves fees out', () => {
  const postings = [
    { lpEntityId: 'lp', amount: -1000, sourceType: 'capital_call', entryDate: '2025-01-01' },
    { lpEntityId: 'lp', amount: 100, sourceType: 'management_fee', entryDate: '2025-03-31' },
    { lpEntityId: 'lp', amount: 50, sourceType: 'partnership_expense', entryDate: '2025-06-30' },
  ]

  it('tags the LP capital that paid the fee and the expenses, first in first out', () => {
    expect(datedContributions(postings, new Set(), '2026-01-01')).toEqual([
      { date: '2025-01-01', amount: 100, purpose: 'fees' },
      { date: '2025-01-01', amount: 50, purpose: 'expenses' },
      { date: '2025-01-01', amount: 850, purpose: 'investments' },
    ])
  })

  it('lets a later call pay a fee charged before there was capital to pay it', () => {
    expect(datedContributions([
      { lpEntityId: 'lp', amount: 100, sourceType: 'management_fee', entryDate: '2025-01-01' },
      { lpEntityId: 'lp', amount: -1000, sourceType: 'capital_call', entryDate: '2025-02-01' },
    ], new Set(), '2026-01-01')).toEqual([
      { date: '2025-02-01', amount: 100, purpose: 'fees' },
      { date: '2025-02-01', amount: 900, purpose: 'investments' },
    ])
  })

  it('returns only the invested capital before the split', () => {
    const contributions = datedContributions(postings, new Set(), '2026-01-01')
    const terms = straight({ capitalIncludes: ['investments'] })
    expect(replayWaterfallState([], contributions, terms, '2026-01-01').contributedCapital).toBe(850)
    const split = splitDistribution({
      total: 1000,
      terms,
      partners: [{ lpEntityId: 'lp', contributed: 1000, distributed: 0, ending: 850 }],
      contributions,
      priors: [],
      asOf: '2026-01-01',
    })
    expect(split.tiers.returnOfCapital).toBe(850)
    expect(split.tiers.carry).toBe(30)
  })

  it('stores the purposes as text and treats all four as the default', () => {
    expect(carryTermsFromRow({ kind: 'european', capital_includes: ['investments'] }).capitalIncludes).toEqual(['investments'])
    expect(carryTermsFromRow({ kind: 'european', capital_includes: ['investments', 'fees', 'expenses', 'other'] }).capitalIncludes).toBeUndefined()
  })
})
