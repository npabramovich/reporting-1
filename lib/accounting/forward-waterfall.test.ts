import { describe, expect, it } from 'vitest'
import { realizedCapitalFromDeals, replayWaterfallState, splitDistribution, type DealHistory, type VehicleCarryTerms } from '@portfolio/fund-engine'
import { forwardWaterfall, projectedDeals, WHOLE_FUND_FALLBACK_WARNING, type ProjectedDeals } from './forward-waterfall'
import type { DealTimeline } from './construction-forecast'
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

function forecast(p: ConstructionWaterfallProjection, calls: [string, number][], dists: [string, number][], deals?: ProjectedDeals) {
  const w = forwardWaterfall(p, deals)!
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

// Three deals bought on the first call: one sells early for a big gain, one is written off, and
// the last sells late. Every flow is projected, at factor 1 (no fees, no GP stake).
const american = (over: Partial<ConstructionWaterfallProjection> = {}) =>
  blank({ kind: 'american', dealByDeal: { deals: [], lpShare: 1, expenses: 0 }, ...over })
const threeDeals: ProjectedDeals = {
  investments: [
    { deal: 'a', date: '2026-01-31', amount: 40_000 },
    { deal: 'b', date: '2026-01-31', amount: 30_000 },
    { deal: 'c', date: '2026-01-31', amount: 30_000 },
  ],
  exits: [
    { deal: 'a', date: '2028-01-31' },
    { deal: 'b', date: '2029-01-31' },
    { deal: 'c', date: '2031-01-31' },
  ],
  expenses: [],
}
const asHistories = (d: ProjectedDeals): DealHistory[] => ['a', 'b', 'c'].map(k => ({
  companyId: k,
  investments: d.investments.filter(i => i.deal === k).map(i => ({ date: i.date, amount: i.amount })),
  realizations: d.exits.filter(x => x.deal === k).map(x => ({ date: x.date, costExited: null })),
}))

/** What the books would split for the same flows under American terms, from the same deals. */
function bookedAmerican(p: ConstructionWaterfallProjection, calls: [string, number][], dists: [string, number][], deals: DealHistory[]) {
  const contributions = calls.map(([date, amount]) => ({ date, amount }))
  const realizedCapital = realizedCapitalFromDeals(deals, { factor: 1 })
  const priors: { date: string; amount: number }[] = []
  return dists.map(([date, amount]) => {
    const contributed = contributions.filter(c => c.date <= date).reduce((s, c) => s + c.amount, 0)
    const s = splitDistribution({
      total: amount, asOf: date, contributions, priors: [...priors], terms: terms(p), realizedCapital,
      partners: [{ lpEntityId: 'lp', contributed, distributed: 0, ending: 0 }, { lpEntityId: 'gp', contributed: 0, distributed: 0, ending: 0 }],
    })
    priors.push({ date, amount })
    return s.tiers.toGP
  })
}

describe('a deal-by-deal waterfall runs on the deals', () => {
  const calls: [string, number][] = [['2026-01-31', 100_000]]
  const dists: [string, number][] = [['2028-01-31', 90_000], ['2031-01-31', 60_000]]

  it('splits each projected distribution as the books would', () => {
    const forecastCarry = forecast(american(), calls, dists, threeDeals)
    expect(forecastCarry).toEqual(bookedAmerican(american(), calls, dists, asHistories(threeDeals)))
  })

  it('pays carry on the early winner, which the whole-fund waterfall does not', () => {
    const [early] = forecast(american(), calls, dists, threeDeals)
    const [wholeFund] = forecast(blank({}), calls, dists)
    expect(early).toBe(10_000) // 20% of a's 50,000 gain
    expect(wholeFund).toBe(0)
  })

  it('no longer warns once it has the deals', () => {
    expect(forwardWaterfall(american(), threeDeals)!.wholeFundFallback).toBe(false)
    const r = runMonthlyWaterfall(new Map([['2028-01', 150_000]]), new Map([['2026-01', 100_000]]), ['2026-01', '2027-01', '2028-01'], american(), threeDeals)
    expect(r.warnings).toEqual([])
    expect(r.byMonth.get('2028-01')!.carry).toBeGreaterThan(0)
  })

  it('values what is left as a liquidation would, whole fund', () => {
    const w = forwardWaterfall(american(), threeDeals)!
    w.contribute('2026-01-31', 100_000)
    expect(w.stateAt('2027-01-31').contributedCapital).toBe(0) // nothing realized yet
    expect(w.liquidationStateAt('2027-01-31').contributedCapital).toBe(100_000)
  })

  it('starts from the deals and distributions already on the books', () => {
    // Deal a sold in 2028 for 150,000, before the forecast starts; b and c are still held.
    const books = asHistories(threeDeals).map(d => d.companyId === 'a' ? d : { ...d, realizations: [] })
    const p = american({
      asOf: '2028-12-31', lpCalledCapital: 100_000, lpDistributedCapital: 150_000 - 0, fundDistributedCapital: 150_000,
      contributions: [{ date: '2026-01-31', amount: 100_000 }], distributions: [{ date: '2028-01-31', amount: 150_000 }],
      dealByDeal: { deals: books, lpShare: 1, expenses: 0 },
    })
    const w = forwardWaterfall(p, { investments: [], exits: [{ deal: 'c', date: '2031-01-31' }], expenses: [] })!
    const replayed = replayWaterfallState([{ date: '2028-01-31', amount: 150_000 }], p.contributions, terms(p), '2028-12-31', {
      realizedCapital: realizedCapitalFromDeals(books, { factor: 1 }),
    })
    expect(w.stateAt('2028-12-31').returnedCapital).toBe(replayed.returnedCapital)
    expect(w.stateAt('2028-12-31').preferredPaid).toBe(replayed.preferredPaid)
    // c's exit brings its cost into the base; b, never realized in the forecast, stays out.
    expect(w.stateAt('2031-01-31').contributedCapital).toBe(70_000)
  })

  it('grosses the base up for fees and expenses spread over the deals by cost', () => {
    const p = american({ dealByDeal: { deals: [], lpShare: 0.9, expenses: 10_000 } })
    const w = forwardWaterfall(p, threeDeals)!
    w.contribute('2026-01-31', 100_000)
    // a is 40,000 of 100,000 of cost: 40,000 × 0.9 × (1 + 10,000 ÷ 100,000).
    expect(w.stateAt('2028-01-31').contributedCapital).toBe(39_600)
  })
})

describe('projectedDeals', () => {
  const deal = (over: Partial<DealTimeline>): DealTimeline => ({
    key: 'k', name: 'Acme', kind: 'planned', investedToDate: 0, currentValue: 0, initialCheck: 0, initialAt: 0,
    followOn: 0, followOnAt: 0, proceeds: 0, exitAt: 0, timing: 'stated', ...over,
  })
  const at = (t: number) => `t${t}`

  it('places checks and exits after today, write-offs included', () => {
    const out = projectedDeals([
      deal({ key: 'a', initialCheck: 100, initialAt: 1, followOn: 50, followOnAt: 2, proceeds: 0, exitAt: 3 }),
      deal({ key: 'b', kind: 'existing', investedToDate: 100, initialAt: -2, proceeds: 300, exitAt: 4 }),
    ], 10, at)
    expect(out.investments).toEqual([{ deal: 'a', date: 't1', amount: 100 }, { deal: 'a', date: 't2', amount: 50 }])
    expect(out.exits).toEqual([{ deal: 'a', date: 't3' }, { deal: 'b', date: 't4' }])
  })

  it('leaves out exits past the horizon and deals already exited', () => {
    const out = projectedDeals([deal({ key: 'a', proceeds: 100, exitAt: 12 }), deal({ key: 'b', proceeds: null, exitAt: 2 })], 10, at)
    expect(out.exits).toEqual([])
  })
})
