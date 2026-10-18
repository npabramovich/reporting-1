import { describe, it, expect } from 'vitest'
import {
  amountsFromRow,
  itemLVariance,
  parseReceivedK1Amounts,
  receivedK1AmountProblems,
  rowFromAmounts,
  RECEIVED_K1_FIELDS,
} from './received-k1-amounts'

describe('received K-1 amounts', () => {
  it('round-trips through the received_k1s columns', () => {
    const amounts = { interest: 1_000, qualifiedDividends: 250.5, capitalEnding: 100_000 }
    const row: Record<string, unknown> = { ...rowFromAmounts(amounts), amounts_recorded_at: '2025-03-01T00:00:00Z' }
    expect(amountsFromRow(row)).toEqual(amounts)
    // Every field is written, so a cleared box clears.
    expect(row.box1_ordinary_business).toBeNull()
  })

  it('reads a row with no amounts recorded as none, never as a K-1 of zeros', () => {
    expect(amountsFromRow({ box5_interest: 0, amounts_recorded_at: null })).toBeNull()
    expect(amountsFromRow(null)).toBeNull()
  })

  it('has one distinct column per field', () => {
    expect(new Set(RECEIVED_K1_FIELDS.map(f => f.column)).size).toBe(RECEIVED_K1_FIELDS.length)
    expect(new Set(RECEIVED_K1_FIELDS.map(f => f.key)).size).toBe(RECEIVED_K1_FIELDS.length)
  })

  it('refuses an unknown key rather than dropping it', () => {
    expect(parseReceivedK1Amounts({ shortTermGains: 5 })).toMatchObject({ error: expect.stringContaining('Unknown K-1 amount') })
    expect(parseReceivedK1Amounts([1])).toMatchObject({ error: expect.any(String) })
    expect(parseReceivedK1Amounts({ interest: 'abc' })).toMatchObject({ error: expect.stringContaining('not a number') })
    expect(parseReceivedK1Amounts({ interest: '1,250.00', royalties: null })).toEqual({ amounts: { interest: 1250 } })
  })

  it('refuses 6b above 6a and negative deductions', () => {
    expect(receivedK1AmountProblems({ ordinaryDividends: 100, qualifiedDividends: 150 })).toHaveLength(1)
    expect(receivedK1AmountProblems({ ordinaryDividends: 100, qualifiedDividends: 100 })).toEqual([])
    expect(receivedK1AmountProblems({ otherDeductions: -5 })[0]).toMatch(/positive/)
  })

  it('reports whether Item L foots as entered', () => {
    expect(itemLVariance({ capitalBeginning: 100, capitalContributed: 50, capitalCurrentYearIncome: 20, capitalWithdrawals: 30, capitalEnding: 140 })).toBe(0)
    expect(itemLVariance({ capitalBeginning: 100, capitalEnding: 90 })).toBe(-10)
    expect(itemLVariance({ capitalEnding: 90 })).toBeNull()
  })
})
