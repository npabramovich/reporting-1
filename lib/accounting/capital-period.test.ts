import { describe, it, expect } from 'vitest'
import { computeCapitalAccounts, rollForwardTies, ACTIVITY_FIELDS } from './capital-account'
import { resolvePeriod } from './statement-period'

// LP 'a': opened 100k (2025), called 50k + fee 2k in Q1-2026, marked up 30k in Q2-2026.
const postings = [
  { lpEntityId: 'a', amount: -100_000, sourceType: 'opening_balance', entryDate: '2025-06-30' },
  { lpEntityId: 'a', amount: -50_000, sourceType: 'capital_call', entryDate: '2026-02-15' },
  { lpEntityId: 'a', amount: 2_000, sourceType: 'management_fee', entryDate: '2026-03-31' },
  { lpEntityId: 'a', amount: -30_000, sourceType: 'valuation', entryDate: '2026-05-10' },
  { lpEntityId: 'a', amount: -1_000, sourceType: 'income', entryDate: '2026-05-31' },
]

describe('period roll-forward', () => {
  it('inception to date: beginning holds only the opening balance', () => {
    const a = computeCapitalAccounts(postings).get('a')!
    expect(a.beginning).toBe(100_000)
    expect(a.contributions).toBe(50_000)
    expect(a.managementFees).toBe(-2_000)
    expect(a.unrealizedGains).toBe(30_000)
    expect(a.operatingIncome).toBe(1_000)
    expect(a.ending).toBe(179_000)
    expect(rollForwardTies(a)).toBe(true)
  })

  it('carries the prior balance into `beginning` and shows only in-period activity', () => {
    // Q2 2026: opens at 148k (100k + 50k − 2k), picks up the 30k mark and 1k income.
    const a = computeCapitalAccounts(postings, { start: '2026-04-01', end: '2026-06-30' }).get('a')!
    expect(a.beginning).toBe(148_000)
    expect(a.contributions).toBe(0)   // the call was last quarter
    expect(a.managementFees).toBe(0)
    expect(a.unrealizedGains).toBe(30_000)
    expect(a.operatingIncome).toBe(1_000)
    expect(a.ending).toBe(179_000)
    expect(rollForwardTies(a)).toBe(true)
  })

  it('excludes activity after the period end', () => {
    // Q1 2026 ends before the mark; ending must not include it.
    const a = computeCapitalAccounts(postings, { start: '2026-01-01', end: '2026-03-31' }).get('a')!
    expect(a.beginning).toBe(100_000)
    expect(a.contributions).toBe(50_000)
    expect(a.managementFees).toBe(-2_000)
    expect(a.unrealizedGains).toBe(0)
    expect(a.ending).toBe(148_000)
    expect(rollForwardTies(a)).toBe(true)
  })

  it('ending is the same number whichever period you view it through', () => {
    const itd = computeCapitalAccounts(postings, { end: '2026-06-30' }).get('a')!
    const q2 = computeCapitalAccounts(postings, { start: '2026-04-01', end: '2026-06-30' }).get('a')!
    expect(q2.ending).toBe(itd.ending)
  })

  it('an unknown source_type lands in `unclassified` rather than vanishing', () => {
    const a = computeCapitalAccounts([
      { lpEntityId: 'a', amount: -5_000, sourceType: 'something_new', entryDate: '2026-05-01' },
    ]).get('a')!
    expect(a.unclassified).toBe(5_000)
    expect(a.ending).toBe(5_000)
    expect(rollForwardTies(a)).toBe(true)
  })

  it('a transfer between partners nets to zero across the fund', () => {
    const accounts = computeCapitalAccounts([
      { lpEntityId: 'a', amount: 10_000, sourceType: 'transfer', entryDate: '2026-05-01' },
      { lpEntityId: 'b', amount: -10_000, sourceType: 'transfer', entryDate: '2026-05-01' },
    ])
    expect(accounts.get('a')!.transfers).toBe(-10_000)
    expect(accounts.get('b')!.transfers).toBe(10_000)
    const net = ACTIVITY_FIELDS.reduce((s, f) => s + accounts.get('a')![f] + accounts.get('b')![f], 0)
    expect(net).toBe(0)
  })
})

describe('resolvePeriod', () => {
  const today = new Date('2026-05-15T00:00:00Z') // Q2 2026

  it('this quarter', () => {
    expect(resolvePeriod('this_quarter', today)).toMatchObject({ start: '2026-04-01', end: '2026-06-30', label: 'Q2 2026' })
  })
  it('last quarter', () => {
    expect(resolvePeriod('last_quarter', today)).toMatchObject({ start: '2026-01-01', end: '2026-03-31', label: 'Q1 2026' })
  })
  it('last quarter crosses the year boundary', () => {
    expect(resolvePeriod('last_quarter', new Date('2026-02-10T00:00:00Z')))
      .toMatchObject({ start: '2025-10-01', end: '2025-12-31', label: 'Q4 2025' })
  })
  it('year to date', () => {
    expect(resolvePeriod('ytd', today)).toMatchObject({ start: '2026-01-01', end: '2026-05-15' })
  })
  it('prior year', () => {
    expect(resolvePeriod('prior_year', today)).toMatchObject({ start: '2025-01-01', end: '2025-12-31', label: 'FY 2025' })
  })
  it('inception to date has no bounds', () => {
    expect(resolvePeriod('itd', today)).toMatchObject({ start: null, end: null })
  })
})
