import { describe, expect, it } from 'vitest'
import { clawbackAtFundEnd, hurdleTarget, runWaterfall, yearFraction, type VehicleCarryTerms } from '../src/index.ts'

const european = (over: Partial<VehicleCarryTerms> = {}): VehicleCarryTerms => ({
  kind: 'european', carryRate: 0.2, prefRate: 0.08, catchupRate: 1, catchupSize: 1, prefCompounds: true,
  prefBase: 'contributed', gpEntityId: 'gp', recipients: [{ lpEntityId: 'gp', pct: 100 }], ...over,
})

describe('the hurdle terms', () => {
  it('counts 30/360 years by the US rule', () => {
    expect(yearFraction('2026-01-31', '2026-03-31', '30/360')).toBeCloseTo(60 / 360, 12)
    expect(yearFraction('2026-01-30', '2026-03-31', '30/360')).toBeCloseTo(60 / 360, 12)
    expect(yearFraction('2026-01-29', '2026-03-31', '30/360')).toBeCloseTo(62 / 360, 12)
    expect(yearFraction('2024-01-01', '2025-01-01')).toBeCloseTo(366 / 365, 12)
  })

  it('sets a multiple hurdle on the capital owed, however long it takes', () => {
    const t = european({ prefMultiple: 1.08 })
    expect(hurdleTarget(t, [{ date: '2026-01-01', amount: 1000 }], 1000, '2036-01-01')).toBe(80)
  })

  it('accrues a 30/360 simple pref', () => {
    const t = european({ prefCompounds: false, prefDayCount: '30/360' })
    expect(hurdleTarget(t, [{ date: '2026-01-31', amount: 1000 }], 1000, '2026-07-31')).toBe(40)
  })
})

describe('a catch-up measured on profit', () => {
  it('catches the GP up to its full share when the LPs share the flow', () => {
    // 100 in, 46.93 of pref paid, then a 50/50 catch-up to 20%: under 'profit' the GP reaches
    // 20% of everything after capital; under 'preferred' it stops at 25% of the pref.
    const state = { contributedCapital: 100, returnedCapital: 100, preferredPaid: 0, preferredTarget: 46.93, gpCarryPaid: 0 }
    const profit = runWaterfall(100, { carryRate: 0.2, catchUpRate: 0.5, catchUpMeasure: 'profit' }, state)
    const preferred = runWaterfall(100, { carryRate: 0.2, catchUpRate: 0.5 }, state)
    expect(profit.toGP).toBe(20)
    expect(preferred.toGP).toBeCloseTo(17.65, 2)
  })
})

describe('the clawback at fund end', () => {
  it('gives back carry an early exit paid before the later capital came back', () => {
    // 100 called, 150 back (carry paid on 50 of profit), then 100 more called and lost.
    const terms = european({ prefRate: 0, kind: 'straight' })
    const contributions = [{ date: '2026-01-01', amount: 100 }, { date: '2027-01-01', amount: 100 }]
    const c = clawbackAtFundEnd([{ date: '2026-07-01', amount: 150 }], contributions, terms, '2030-12-31', 10)
    // On the fund-end view 150 never covers the 200 of capital, so none of the 10 was earned.
    expect(c).toEqual({ paid: 10, entitlement: 0, amount: 10 })
  })
})
