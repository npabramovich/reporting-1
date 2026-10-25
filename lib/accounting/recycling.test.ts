import { describe, it, expect } from 'vitest'
import { buildRecycledProceedsEntry } from './entries'
import { parseRecyclingTerms } from './recycling'
import { computeCapitalAccounts } from './capital-account'
import { deriveMetrics } from './live-report'
import { describeRecyclingTerms } from '@/lib/pending-actions/recycling'

const capMap = new Map([['a', 'cap-a'], ['b', 'cap-b']])

describe('the netted entry for deemed recycling', () => {
  const entry = buildRecycledProceedsEntry(
    { fundId: 'f', entryDate: '2028-06-30', memo: 'Recycled proceeds' },
    new Map([['a', 6_000], ['b', 4_000]]), capMap, 'payable',
  )

  it('balances, moves no cash, and nets the payable and each capital account to zero', () => {
    expect(entry.sourceType).toBe('recycled_proceeds')
    expect(entry.postings.reduce((s, p) => s + p.amount, 0)).toBe(0)
    const by = (accountId: string, lp: string) => entry.postings.filter(p => p.accountId === accountId && p.lpEntityId === lp).reduce((s, p) => s + p.amount, 0)
    expect(by('payable', 'a')).toBe(0)
    expect(by('cap-a', 'a')).toBe(0)
    expect(entry.postings.every(p => p.accountId === 'payable' || p.accountId.startsWith('cap-'))).toBe(true)
  })

  it("shows on each partner's statement as both a distribution and a contribution, with their commitment unchanged", () => {
    const capital = [
      { lpEntityId: 'a', amount: -60_000, sourceType: 'capital_call', entryDate: '2026-01-31' },
      ...entry.postings.filter(p => p.accountId.startsWith('cap-')).map(p => ({ lpEntityId: p.lpEntityId!, amount: p.amount, sourceType: entry.sourceType, entryDate: entry.entryDate })),
    ]
    const a = computeCapitalAccounts(capital).get('a')!
    expect([a.contributions, a.distributions, a.ending]).toEqual([66_000, -6_000, 60_000])
    const m = deriveMetrics(a, 100_000, 0, null, 6_000)
    expect(m.called_capital).toBe(66_000)
    expect(m.distributions).toBe(6_000)
    expect(m.outstanding_balance).toBe(40_000)
  })
})

describe('recycling terms', () => {
  it('reads a cap, an end date and a default treatment', () => {
    const t = parseRecyclingTerms({ capRate: 0.2, until: '2030-12-31', defaultTreatment: 'deemed' })
    expect(t).toEqual({ ok: true, value: { capRate: 0.2, capBasis: 'commitments', until: '2030-12-31', uses: 'any', defaultTreatment: 'deemed' } })
    expect(describeRecyclingTerms((t as any).value)).toBe('up to 20% of commitments until 2030-12-31, distributed and recontributed by default')
  })

  it('refuses what the table would', () => {
    expect(parseRecyclingTerms({ capRate: -0.1 })).toHaveProperty('error')
    expect(parseRecyclingTerms({ capRate: 0.2, capBasis: 'nav' })).toHaveProperty('error')
    expect(parseRecyclingTerms({ capRate: 0.2, until: 'end of 2030' })).toHaveProperty('error')
    expect(parseRecyclingTerms({ capRate: 0.2, defaultTreatment: 'distributed' })).toHaveProperty('error')
  })
})
