import { describe, it, expect } from 'vitest'
import {
  computeFxRevaluation,
  derivePriorFxRate,
  deriveLocalSharePrice,
  deriveOriginalCurrency,
  deriveOriginalPositionValue,
  formatFxRate,
} from './fx'
import type { InvestmentTransaction } from '@/lib/types/database'

function txn(overrides: Partial<InvestmentTransaction>): InvestmentTransaction {
  return {
    id: overrides.id ?? 'x',
    company_id: 'c',
    fund_id: 'f',
    transaction_type: 'investment',
    round_name: null,
    transaction_date: null,
    notes: null,
    investment_cost: null,
    interest_converted: null,
    shares_acquired: null,
    share_price: null,
    cost_basis_exited: null,
    proceeds_received: null,
    proceeds_escrow: null,
    proceeds_written_off: null,
    proceeds_per_share: null,
    unrealized_value_change: null,
    current_share_price: null,
    postmoney_valuation: null,
    latest_postmoney_valuation: null,
    exit_valuation: null,
    ownership_pct: null,
    portfolio_group: null,
    original_currency: null,
    original_investment_cost: null,
    original_share_price: null,
    original_postmoney_valuation: null,
    original_proceeds_received: null,
    original_proceeds_per_share: null,
    original_exit_valuation: null,
    original_unrealized_value_change: null,
    original_current_share_price: null,
    original_latest_postmoney_valuation: null,
    valuation_change_source: null,
    fx_rate: null,
    prior_fx_rate: null,
    fx_value_change: null,
    original_position_value: null,
    created_at: null,
    updated_at: null,
    ...overrides,
  } as InvestmentTransaction
}

describe('computeFxRevaluation', () => {
  it('books a loss when the deal currency weakens against the fund currency', () => {
    const result = computeFxRevaluation({
      positionValueOriginal: 1_000_000,
      priorRate: 1.1,
      newRate: 1.05,
    })

    expect(result.priorFundValue).toBeCloseTo(1_100_000, 6)
    expect(result.newFundValue).toBeCloseTo(1_050_000, 6)
    expect(result.fxValueChange).toBeCloseTo(-50_000, 6)
    expect(result.newFundSharePrice).toBeNull()
  })

  it('books a gain when the deal currency strengthens', () => {
    const result = computeFxRevaluation({
      positionValueOriginal: 1_000_000,
      priorRate: 1.1,
      newRate: 1.2,
    })
    expect(result.fxValueChange).toBeCloseTo(100_000, 6)
  })

  it('is a no-op when the rate is unchanged', () => {
    const result = computeFxRevaluation({
      positionValueOriginal: 250_000,
      priorRate: 1.32,
      newRate: 1.32,
    })
    expect(result.fxValueChange).toBeCloseTo(0, 9)
  })

  it('converts the local share price at the new rate for priced equity', () => {
    const result = computeFxRevaluation({
      positionValueOriginal: 1_000_000,
      priorRate: 1.1,
      newRate: 1.05,
      localSharePrice: 2,
    })
    expect(result.newFundSharePrice).toBeCloseTo(2.1, 6)
  })

  it('leaves share price null when the local price is absent or zero', () => {
    const base = { positionValueOriginal: 100, priorRate: 1, newRate: 2 }
    expect(computeFxRevaluation({ ...base, localSharePrice: null }).newFundSharePrice).toBeNull()
    expect(computeFxRevaluation({ ...base, localSharePrice: 0 }).newFundSharePrice).toBeNull()
  })

  it('handles rates below 1 (e.g. a JPY deal in a USD fund)', () => {
    const result = computeFxRevaluation({
      positionValueOriginal: 150_000_000,
      priorRate: 0.0067,
      newRate: 0.0063,
    })
    expect(result.priorFundValue).toBeCloseTo(1_005_000, 4)
    expect(result.newFundValue).toBeCloseTo(945_000, 4)
    expect(result.fxValueChange).toBeCloseTo(-60_000, 4)
  })
})

describe('derivePriorFxRate', () => {
  it('prefers an explicit fx_rate on the latest transaction', () => {
    const txns = [
      txn({ id: 'a', transaction_date: '2025-01-01', original_currency: 'EUR', investment_cost: 1_100_000, original_investment_cost: 1_000_000 }),
      txn({ id: 'b', transaction_date: '2025-06-30', original_currency: 'EUR', transaction_type: 'unrealized_gain_change', fx_rate: 1.05 }),
    ]
    expect(derivePriorFxRate(txns, 'EUR')).toBeCloseTo(1.05, 9)
  })

  it('falls back to the rate implied by cost when no explicit rate exists', () => {
    const txns = [
      txn({ id: 'a', transaction_date: '2025-01-01', original_currency: 'EUR', investment_cost: 1_100_000, original_investment_cost: 1_000_000 }),
    ]
    expect(derivePriorFxRate(txns, 'EUR')).toBeCloseTo(1.1, 9)
  })

  it('prefers current share price over cost basis on the same transaction', () => {
    const txns = [
      txn({
        id: 'a', transaction_date: '2025-01-01', original_currency: 'EUR',
        current_share_price: 2.1, original_current_share_price: 2,
        investment_cost: 1_100_000, original_investment_cost: 1_000_000,
      }),
    ]
    expect(derivePriorFxRate(txns, 'EUR')).toBeCloseTo(1.05, 9)
  })

  it('ignores transactions in a different currency', () => {
    const txns = [
      txn({ id: 'a', transaction_date: '2025-01-01', original_currency: 'GBP', investment_cost: 1_300_000, original_investment_cost: 1_000_000 }),
    ]
    expect(derivePriorFxRate(txns, 'EUR')).toBeNull()
  })

  it('excludes the transaction being edited so it cannot seed from itself', () => {
    const txns = [
      txn({ id: 'a', transaction_date: '2025-01-01', original_currency: 'EUR', investment_cost: 1_100_000, original_investment_cost: 1_000_000 }),
      txn({ id: 'b', transaction_date: '2025-06-30', original_currency: 'EUR', fx_rate: 1.05 }),
    ]
    expect(derivePriorFxRate(txns, 'EUR', 'b')).toBeCloseTo(1.1, 9)
  })

  it('returns null when no rate can be implied', () => {
    expect(derivePriorFxRate([txn({ original_currency: 'EUR' })], 'EUR')).toBeNull()
    expect(derivePriorFxRate([], 'EUR')).toBeNull()
  })

  it('sorts undated transactions last', () => {
    const txns = [
      txn({ id: 'a', transaction_date: null, original_currency: 'EUR', fx_rate: 9.99 }),
      txn({ id: 'b', transaction_date: '2025-06-30', original_currency: 'EUR', fx_rate: 1.05 }),
    ]
    expect(derivePriorFxRate(txns, 'EUR')).toBeCloseTo(1.05, 9)
  })
})

describe('deriveLocalSharePrice', () => {
  it('prefers the latest mark price over the original round price', () => {
    const txns = [
      txn({ id: 'a', transaction_date: '2025-01-01', original_currency: 'EUR', original_share_price: 1 }),
      txn({ id: 'b', transaction_date: '2025-06-30', original_currency: 'EUR', original_current_share_price: 2 }),
    ]
    expect(deriveLocalSharePrice(txns, 'EUR')).toBe(2)
  })

  it('falls back to the round share price', () => {
    const txns = [txn({ transaction_date: '2025-01-01', original_currency: 'EUR', original_share_price: 1.5 })]
    expect(deriveLocalSharePrice(txns, 'EUR')).toBe(1.5)
  })

  it('skips zero prices from SAFEs and warrants', () => {
    const txns = [
      txn({ id: 'a', transaction_date: '2025-06-30', original_currency: 'EUR', original_share_price: 0 }),
      txn({ id: 'b', transaction_date: '2025-01-01', original_currency: 'EUR', original_share_price: 1.5 }),
    ]
    expect(deriveLocalSharePrice(txns, 'EUR')).toBe(1.5)
  })

  it('returns null when nothing is priced in the original currency', () => {
    expect(deriveLocalSharePrice([txn({ original_currency: 'EUR' })], 'EUR')).toBeNull()
  })
})

describe('deriveOriginalCurrency', () => {
  it('returns the currency of the most recent transaction that has one', () => {
    const txns = [
      txn({ id: 'a', transaction_date: '2025-01-01', original_currency: 'GBP' }),
      txn({ id: 'b', transaction_date: '2025-06-30', original_currency: 'EUR' }),
      txn({ id: 'c', transaction_date: '2025-09-30' }),
    ]
    expect(deriveOriginalCurrency(txns)).toBe('EUR')
  })

  it('returns null when the deal is in fund currency', () => {
    expect(deriveOriginalCurrency([txn({})])).toBeNull()
  })
})

describe('deriveOriginalPositionValue', () => {
  it('back-converts the fund-currency carrying value at the prior rate', () => {
    expect(deriveOriginalPositionValue(1_100_000, 1.1)).toBeCloseTo(1_000_000, 6)
  })

  it('round-trips with computeFxRevaluation', () => {
    const positionValueOriginal = deriveOriginalPositionValue(1_100_000, 1.1)!
    const result = computeFxRevaluation({ positionValueOriginal, priorRate: 1.1, newRate: 1.1 })
    expect(result.newFundValue).toBeCloseTo(1_100_000, 6)
    expect(result.fxValueChange).toBeCloseTo(0, 9)
  })

  it('guards against a non-positive rate', () => {
    expect(deriveOriginalPositionValue(1_000, 0)).toBeNull()
    expect(deriveOriginalPositionValue(1_000, -1)).toBeNull()
  })
})

describe('formatFxRate', () => {
  it('quotes to four decimal places', () => {
    expect(formatFxRate(1.1)).toBe('1.1000')
    expect(formatFxRate(0.0067)).toBe('0.0067')
  })

  it('renders a dash for a missing rate', () => {
    expect(formatFxRate(null)).toBe('-')
    expect(formatFxRate(undefined)).toBe('-')
  })
})
