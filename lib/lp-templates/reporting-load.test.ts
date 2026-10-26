import { describe, it, expect } from 'vitest'
import { NO_CARRY, type VehicleCarryTerms } from '@portfolio/fund-engine'
import { earnedCarryShare } from './reporting-load'

const terms: VehicleCarryTerms = { ...NO_CARRY, kind: 'straight', carryRate: 0.2, gpEntityId: 'G', recipients: [{ lpEntityId: 'G', pct: 100 }] }
const p = (lpEntityId: string, amount: number, sourceType: string, entryDate = '2026-06-30') => ({ lpEntityId, amount, sourceType, entryDate, entryId: sourceType, currency: 'USD' })

describe('earnedCarryShare', () => {
  // 100 in, 50 realized, 50 unrealized: carry 20, of which the realized 50 supports 10.
  const postings = [
    p('A', -100, 'capital_call', '2026-01-15'),
    p('A', -50, 'realized_gain'),
    p('A', -50, 'valuation'),
    p('A', 20, 'carried_interest'),
    p('G', -20, 'carried_interest'),
  ]

  it('is the share of the carry charged that realized profits alone support', () => {
    expect(earnedCarryShare(postings, terms, '2026-06-30')).toBeCloseTo(0.5, 10)
  })

  it('is nothing before any carry is charged, or without carry terms', () => {
    expect(earnedCarryShare(postings, terms, '2026-03-31')).toBe(0)
    expect(earnedCarryShare(postings, NO_CARRY, '2026-06-30')).toBe(0)
  })
})
