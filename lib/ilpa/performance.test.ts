import { describe, expect, it } from 'vitest'
import { buildIlpaPerformance, computeSeries, consolidateFlows, performanceSheetRows, portfolioPerformance, type PerformanceFlow } from './performance'
import { PERFORMANCE_TYPES, TREATMENT } from './performance-types'
import { callWeights, splitByWeights, typedPerformanceFlows } from './performance-load'
import { facilitiesWithStatus } from '@/lib/accounting/credit-facility'

const f = (date: string, type: PerformanceFlow['type'], amount: number): PerformanceFlow => ({ date, type, amount })

describe('the transaction type mapping', () => {
  it('covers every type, and nets and grosses its IRR and multiple together', () => {
    expect(Object.keys(TREATMENT).sort()).toEqual([...PERFORMANCE_TYPES].sort())
  })

  it('matches the template for the facility rows', () => {
    expect(TREATMENT['Fund-level Subscription Facility Drawdown: Investments']).toMatchObject({ withNet: false, withGross: false, withoutNet: true, withoutGross: true, role: 'denominator' })
    expect(TREATMENT['Capital Call: Fund-level Subscription Facility Fees/Interest']).toMatchObject({ withNet: true, withGross: false, withoutNet: false, withoutGross: false })
    expect(TREATMENT['Synthetic Distribution: Fund-level Subscription Facility Repayment: Investments'].role).toBe('decrease_denominator')
    expect(TREATMENT['Quarter-end Adjustment for Accrued Fees/Interest from Fund-level Subscription Facility']).toMatchObject({ withNet: false, withGross: true, withoutNet: true, withoutGross: true })
    expect(TREATMENT['Capital Call: Management Fees/Partnership Expenses']).toMatchObject({ withNet: true, withGross: false, withoutNet: true, withoutGross: false })
    expect(TREATMENT['Carry / Clawback']).toMatchObject({ withNet: false, withGross: true, withoutNet: false, withoutGross: true, role: 'numerator' })
  })
})

describe('computeSeries', () => {
  // A one-year fund. The line funds an investment on 1 Jan and is repaid by a call on 1 Jul.
  const flows: PerformanceFlow[] = [
    f('2025-01-01', 'Fund-level Subscription Facility Drawdown: Investments', -100),
    f('2025-07-01', 'Capital Call: Investments', -100),
    f('2025-07-01', 'Synthetic Distribution: Fund-level Subscription Facility Repayment: Investments', 100),
    f('2025-07-01', 'Capital Call: Fund-level Subscription Facility Fees/Interest', -2),
    f('2025-07-01', 'Capital Call: Management Fees/Partnership Expenses', -5),
    f('2026-01-01', 'Carry / Clawback', 4),
    f('2026-01-01', 'NAV', 120),
  ]

  it('with the line: the partners\' actual cash, net of fees, interest and carry', () => {
    const r = computeSeries(flows, 'withNet')
    expect(r.denominator).toBe(107)
    expect(r.numerator).toBe(120)
    expect(r.multiple).toBeCloseTo(120 / 107, 10)
    expect(r.irr).toBeGreaterThan(0.2)
  })

  it('without the line: called on the draw date, the call that repaid it undone, interest left out', () => {
    const r = computeSeries(flows, 'withoutNet')
    expect(r.denominator).toBe(105) // 100 drawn + 100 called − 100 synthetic + 5 fees
    expect(r.multiple).toBeCloseTo(120 / 105, 10)
    expect(r.irr!).toBeLessThan(computeSeries(flows, 'withNet').irr!)
  })

  it('gross: fees and interest out of paid-in, carry added back', () => {
    const w = computeSeries(flows, 'withGross')
    expect(w.denominator).toBe(100)
    expect(w.numerator).toBe(124)
    const wo = computeSeries(flows, 'withoutGross')
    expect(wo.denominator).toBe(100)
    expect(wo.numerator).toBe(124)
    expect(wo.irr!).toBeCloseTo(0.24, 2)
  })
})

describe('consolidateFlows and the sheet', () => {
  it('merges a date and type, drops zeros, and orders by date then template order', () => {
    const out = consolidateFlows([
      f('2025-02-01', 'NAV', 10),
      f('2025-01-01', 'Distribution: Permanent', 1),
      f('2025-01-01', 'Capital Call: Investments', -3),
      f('2025-01-01', 'Capital Call: Investments', -2),
      f('2025-01-01', 'Distribution: Recallable', 0.001),
    ])
    expect(out).toEqual([
      f('2025-01-01', 'Capital Call: Investments', -5),
      f('2025-01-01', 'Distribution: Permanent', 1),
      f('2025-02-01', 'NAV', 10),
    ])
  })

  it('lays out every block with ILPA names, and leaves out flows after the date', () => {
    const p = buildIlpaPerformance({
      fund: { name: 'Example Fund I', vehicle: 'Example Fund I', currency: 'USD', asOf: '2025-12-31', basis: 'Since inception' },
      population: { feePayingPartners: 2, excludedPartners: 1, feePayingCommitment: 900, totalCommitment: 1000 },
      portfolio: null,
      facilities: [{ name: 'Subscription line', kind: 'subscription', outstanding: 0, inWithoutSeries: true }],
      footnotes: ['A note.'],
      flows: [f('2025-01-01', 'Capital Call: Investments', -100), f('2025-12-31', 'NAV', 110), f('2026-03-31', 'Distribution: Permanent', 50)],
    })
    expect(p.flows).toHaveLength(2)
    expect(p.totals.map(t => t.type)).toEqual(['Capital Call: Investments', 'NAV'])
    const rows = performanceSheetRows(p)
    const labels = rows.map(r => r[0])
    expect(labels).toContain('Net IRR - With Impact of Fund-level Subscription Facility')
    expect(labels).toContain('Gross Fund-Level MOIC - Without Impact of Fund-level Subscription Facility')
    expect(labels).toContain('Disclosures/Footnotes')
    expect(rows.find(r => r[1] === 'NAV')).toEqual(['2025-12-31', 'NAV', 110, 'Included', 'Included', 'Included', 'Included', 'Numerator'])
  })
})

describe('portfolioPerformance', () => {
  it('splits realized from unrealized and adds the value on the date', () => {
    const p = portfolioPerformance([
      { realized: true, invested: 100, proceeds: 300, value: 0, flows: [{ date: '2024-01-01', amount: -100 }, { date: '2025-01-01', amount: 300 }] },
      { realized: false, invested: 200, proceeds: 0, value: 250, flows: [{ date: '2024-01-01', amount: -200 }] },
    ], '2025-01-01')
    expect(p.realized.grossMoic).toBe(3)
    expect(p.realized.grossIrr!).toBeCloseTo(2, 1) // 2024 is a leap year; xirr counts 365.25-day years
    expect(p.unrealized.grossMoic).toBe(1.25)
    expect(p.total.grossMoic).toBeCloseTo(550 / 300, 10)
    expect(p.total.unrealized).toBe(250)
  })
})

describe('typing a call', () => {
  it('splits by purpose, and carves the facility interest it paid out of fees first', () => {
    const w = callWeights([
      { category: 'investment', amount: 900 },
      { category: 'management_fee', amount: 80 },
      { category: 'other', amount: 20 },
    ], 1000, 100)
    // 80 of fees, then 20 of working capital, become facility interest; investments are untouched.
    expect(Object.fromEntries(w)).toEqual({
      'Capital Call: Investments': 900,
      'Capital Call: Fund-level Subscription Facility Fees/Interest': 100,
    })
    expect(Object.fromEntries(callWeights([{ category: 'fund_expense', amount: 50 }], 50, 10))).toEqual({
      'Capital Call: Management Fees/Partnership Expenses': 40,
      'Capital Call: Fund-level Subscription Facility Fees/Interest': 10,
    })
  })

  it('counts a call with no purposes as investments', () => {
    expect(Object.fromEntries(callWeights([], 500, 0))).toEqual({ 'Capital Call: Investments': 500 })
  })

  it('splits a partner\'s contribution to the cent', () => {
    const parts = splitByWeights(-100, new Map([['Capital Call: Investments', 2], ['Capital Call: Management Fees/Partnership Expenses', 1]]))
    expect(parts).toEqual([
      { type: 'Capital Call: Investments', amount: -66.67 },
      { type: 'Capital Call: Management Fees/Partnership Expenses', amount: -33.33 },
    ])
    expect(parts.reduce((s, p) => s + p.amount, 0)).toBeCloseTo(-100, 10)
  })
})

describe('typedPerformanceFlows', () => {
  // Three partners: A pays the fee (600 committed), B does not (300), the GP (100).
  const register = {
    vehicle: 'Example Fund I',
    vehicleId: 'v1',
    facilities: [{ id: 'f1', name: 'Subscription line', kind: 'subscription' as const, lender: null, commitmentAmount: 1000, openedOn: null, maturesOn: null, rateDescription: null, notes: null }],
    events: [
      { id: 'd1', facilityId: 'f1', type: 'draw' as const, date: '2024-12-01', amount: 500, purpose: 'investment' as const, callId: null, journalEntryId: 'jd', origin: 'posted' as const, memo: null, live: true },
      { id: 'r1', facilityId: 'f1', type: 'repayment' as const, date: '2025-01-02', amount: 500, purpose: null, callId: 'c1', journalEntryId: 'jr', origin: 'posted' as const, memo: null, live: true },
      { id: 'i1', facilityId: 'f1', type: 'interest' as const, date: '2025-01-02', amount: 10, purpose: null, callId: 'c1', journalEntryId: 'ji', origin: 'posted' as const, memo: null, live: true },
    ],
  }
  const run = () => typedPerformanceFlows({
    asOf: '2025-12-31',
    postings: [
      { lpEntityId: 'A', amount: -600, sourceType: 'capital_call', entryDate: '2025-01-01', entryId: 'j1' },
      { lpEntityId: 'B', amount: -300, sourceType: 'capital_call', entryDate: '2025-01-01', entryId: 'j1' },
      { lpEntityId: 'GP', amount: -100, sourceType: 'capital_call', entryDate: '2025-01-01', entryId: 'j1' },
      { lpEntityId: 'A', amount: 120, sourceType: 'distribution', entryDate: '2025-06-30' },
      // The carry reallocated out of the limited partners, and the GP's side of it.
      { lpEntityId: 'A', amount: 30, sourceType: 'carried_interest', entryDate: '2025-06-30' },
      { lpEntityId: 'B', amount: 15, sourceType: 'carried_interest', entryDate: '2025-06-30' },
      { lpEntityId: 'GP', amount: -45, sourceType: 'carried_interest', entryDate: '2025-06-30' },
      { lpEntityId: 'GP', amount: 20, sourceType: 'carry_distribution', entryDate: '2025-06-30' },
      // After the date: left out.
      { lpEntityId: 'A', amount: 50, sourceType: 'distribution', entryDate: '2026-02-01' },
    ],
    classes: new Map([['GP', 'gp']]),
    notFeePaying: new Set(['B']),
    commitmentByLp: new Map([['A', 600], ['B', 300], ['GP', 100]]),
    undatedPartners: new Set(),
    calls: [{ id: 'c1', journalEntryId: 'j1', purposes: [{ category: 'investment', amount: 800 }, { category: 'management_fee', amount: 200 }], total: 1000 }],
    facilities: facilitiesWithStatus(register, '2025-12-31'),
  })

  it('counts only the fee-paying limited partners', () => {
    const t = run()
    expect([t.included, t.excluded, t.feePayingCommitment, t.totalCommitment]).toEqual([1, 2, 600, 1000])
    expect([t.untyped, t.unlinkedCost, t.opening, t.reportedOnly]).toEqual([0, 0, 0, 0])
  })

  it('types the call by its purposes, with the facility interest it paid carved out of fees', () => {
    const at = (date: string) => run().flows.filter(f => f.date === date)
    expect(at('2025-01-01')).toEqual([
      { date: '2025-01-01', type: 'Capital Call: Investments', amount: -480 },
      { date: '2025-01-01', type: 'Capital Call: Management Fees/Partnership Expenses', amount: -114 },
      { date: '2025-01-01', type: 'Capital Call: Fund-level Subscription Facility Fees/Interest', amount: -6 },
    ])
  })

  it('adds the line in the fee-paying share of commitments, and the carry in their share of it', () => {
    const flows = run().flows
    expect(flows.filter(f => f.type.startsWith('Fund-level') || f.type.startsWith('Synthetic'))).toEqual([
      { date: '2024-12-01', type: 'Fund-level Subscription Facility Drawdown: Investments', amount: -300 },
      { date: '2025-01-02', type: 'Synthetic Distribution: Fund-level Subscription Facility Repayment: Investments', amount: 300 },
    ])
    expect(flows.find(f => f.type === 'Carry / Clawback')).toEqual({ date: '2025-06-30', type: 'Carry / Clawback', amount: 13.33 })
    expect(flows.find(f => f.type === 'Quarter-end Adjustment for Carry Allocation')).toEqual({ date: '2025-12-31', type: 'Quarter-end Adjustment for Carry Allocation', amount: 16.67 })
    expect(flows.find(f => f.type === 'NAV')).toEqual({ date: '2025-12-31', type: 'NAV', amount: 450 })
    expect(flows.some(f => f.date > '2025-12-31')).toBe(false)
  })

  it('makes the with-facility net series the partners\' own cash', () => {
    const p = buildIlpaPerformance({
      fund: { name: 'Example Fund I', vehicle: 'Example Fund I', currency: 'USD', asOf: '2025-12-31', basis: 'Since inception' },
      population: { feePayingPartners: 1, excludedPartners: 2, feePayingCommitment: 600, totalCommitment: 1000 },
      portfolio: null, facilities: [], footnotes: [], flows: run().flows,
    })
    expect(p.series.withNet.denominator).toBe(600)
    expect(p.series.withNet.numerator).toBe(570) // 120 distributed + 450 NAV
    // Without the line: 300 drawn a month earlier, the interest out, the call that repaid it undone.
    expect(p.series.withoutNet.denominator).toBe(594)
    // This fund is under water, so holding the capital a month longer spreads the loss thinner.
    expect(p.series.withNet.irr!).toBeLessThan(0)
    expect(p.series.withoutNet.irr!).toBeGreaterThan(p.series.withNet.irr!)
  })
})
