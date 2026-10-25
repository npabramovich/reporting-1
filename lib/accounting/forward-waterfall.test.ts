import { describe, expect, it } from 'vitest'
import { splitDistribution, type VehicleCarryTerms } from '@portfolio/fund-engine'
import { forwardWaterfall, WHOLE_FUND_FALLBACK_WARNING } from './forward-waterfall'
import { runMonthlyWaterfall } from '@/lib/forecast/capital'
import type { ConstructionWaterfallProjection } from './construction'

// A fund with nothing on its books yet, so every call and distribution is projected.
const blank = (over: Partial<ConstructionWaterfallProjection>): ConstructionWaterfallProjection => ({
  asOf: '2025-12-31', kind: 'european', carryRate: 0.2, prefRate: 0.08, catchupRate: 1, prefCompounds: true,
  lpCommitmentShare: 1, lpCalledCapital: 0, lpDistributedCapital: 0, fundDistributedCapital: 0, lpNav: 0,
  contributions: [], ...over,
})

const terms = (p: ConstructionWaterfallProjection): VehicleCarryTerms => ({
  kind: p.kind, carryRate: p.carryRate, prefRate: p.prefRate, catchupRate: p.catchupRate, catchupSize: p.catchupSize,
  prefCompounds: p.prefCompounds, prefBase: p.prefBase, gpEntityId: 'gp', recipients: [{ lpEntityId: 'gp', pct: 100 }],
})

/** What the accounting engine books for the same flows: each distribution split from a replay. */
function booked(p: ConstructionWaterfallProjection, calls: [string, number][], dists: [string, number][]) {
  const contributions = calls.map(([date, amount]) => ({ date, amount }))
  const priors: { date: string; amount: number }[] = []
  return dists.map(([date, amount]) => {
    const contributed = contributions.filter(c => c.date <= date).reduce((s, c) => s + c.amount, 0)
    const s = splitDistribution({
      total: amount, asOf: date, contributions, priors: [...priors], terms: terms(p),
      partners: [{ lpEntityId: 'lp', contributed, distributed: 0, ending: 0 }, { lpEntityId: 'gp', contributed: 0, distributed: 0, ending: 0 }],
    })
    priors.push({ date, amount })
    return s.tiers.toGP
  })
}

function forecast(p: ConstructionWaterfallProjection, calls: [string, number][], dists: [string, number][]) {
  const w = forwardWaterfall(p)!
  const events = [...calls.map(([d, a]) => ({ d, a, call: true })), ...dists.map(([d, a]) => ({ d, a, call: false }))]
    .sort((x, y) => x.d.localeCompare(y.d) || (x.call ? -1 : 1))
  const out: number[] = []
  for (const e of events) {
    if (e.call) w.contribute(e.d, e.a)
    else out.push(w.distribute(e.d, e.a).toGP)
  }
  return out
}

describe('the forecast waterfall runs on the same terms as the books', () => {
  it('honours a half-size catch-up', () => {
    const p = blank({ catchupSize: 0.5 })
    const calls: [string, number][] = [['2026-01-31', 100_000]]
    const dists: [string, number][] = [['2031-01-31', 200_000]]
    expect(forecast(p, calls, dists)).toEqual(booked(p, calls, dists))
    expect(forecast(p, calls, dists)[0]).toBeLessThan(20_000) // a full catch-up would reach 20%
  })

  it('accrues the hurdle on unreturned capital when the terms say so', () => {
    const p = blank({ prefBase: 'unreturned' })
    const calls: [string, number][] = [['2026-01-31', 50_000], ['2029-01-31', 50_000]]
    const dists: [string, number][] = [['2028-01-31', 60_000], ['2032-01-31', 75_000]]
    const contributedBase = forecast(blank({}), calls, dists)
    expect(forecast(p, calls, dists)).toEqual(booked(p, calls, dists))
    expect(forecast(p, calls, dists)).not.toEqual(contributedBase)
  })

  it('reads the unreturned hurdle off the distributions already on the books', () => {
    const history = blank({
      prefBase: 'unreturned', asOf: '2028-12-31', lpCalledCapital: 50_000, lpDistributedCapital: 60_000, fundDistributedCapital: 60_000,
      contributions: [{ date: '2026-01-31', amount: 50_000 }], distributions: [{ date: '2028-01-31', amount: 60_000 }],
    })
    const fresh = forwardWaterfall(blank({ prefBase: 'unreturned' }))!
    fresh.contribute('2026-01-31', 50_000)
    fresh.distribute('2028-01-31', 60_000)
    // The hurdle on 2029-01-31 stops on the capital returned in 2028 either way.
    expect(forwardWaterfall(history)!.stateAt('2029-01-31').preferredTarget).toBe(fresh.stateAt('2029-01-31').preferredTarget)
  })

  it('runs deal-by-deal terms whole fund, and says so', () => {
    const p = blank({ kind: 'american' })
    expect(forwardWaterfall(p)!.wholeFundFallback).toBe(true)
    const r = runMonthlyWaterfall(new Map([['2026-03', 100]]), new Map([['2026-01', 100]]), ['2026-01', '2026-02', '2026-03'], p)
    expect(r.warnings).toEqual([WHOLE_FUND_FALLBACK_WARNING])
  })

  it('passes the catch-up size to the monthly plan as well', () => {
    const months = Array.from({ length: 61 }, (_, i) => `${2026 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`)
    const r = runMonthlyWaterfall(new Map([['2031-01', 200_000]]), new Map([['2026-01', 100_000]]), months, blank({ catchupSize: 0.5 }))
    expect(r.byMonth.get('2031-01')!.carry).toBe(booked(blank({ catchupSize: 0.5 }), [['2026-01-31', 100_000]], [['2031-01-31', 200_000]])[0])
  })

  it('has nothing to run without carry', () => {
    expect(forwardWaterfall(blank({ kind: 'none' }))).toBeNull()
    expect(forwardWaterfall(blank({ carryRate: 0 }))).toBeNull()
  })
})
