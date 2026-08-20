import { describe, it, expect } from 'vitest'
import { computeSummary } from './investments'
import {
  buildFxRevaluationPayload,
  derivePriorFxRate,
  deriveLocalSharePrice,
  deriveOriginalPositionValue,
} from './fx'
import type { InvestmentTransaction } from '@/lib/types/database'

// Integration coverage for the seam between an FX revaluation and the FMV it
// produces: computeSummary reads share price for priced-equity rounds and
// unrealized_value_change for convertibles, so a reval has to land on both.

const BASE = {
  company_id: 'c', fund_id: 'f', round_name: null, transaction_date: null, notes: null,
  investment_cost: null, interest_converted: 0, shares_acquired: null, share_price: null,
  cost_basis_exited: null, proceeds_received: null, proceeds_escrow: 0, proceeds_written_off: 0,
  proceeds_per_share: null, unrealized_value_change: null, current_share_price: null,
  postmoney_valuation: null, latest_postmoney_valuation: null, exit_valuation: null,
  ownership_pct: null, portfolio_group: null, original_currency: null,
  original_investment_cost: null, original_share_price: null, original_postmoney_valuation: null,
  original_proceeds_received: null, original_proceeds_per_share: null, original_exit_valuation: null,
  original_unrealized_value_change: null, original_current_share_price: null,
  original_latest_postmoney_valuation: null, valuation_change_source: null, fx_rate: null,
  prior_fx_rate: null, fx_value_change: null, original_position_value: null,
  created_at: null, updated_at: null,
}

const txn = (o: Partial<InvestmentTransaction>) => ({ ...BASE, ...o }) as InvestmentTransaction

/**
 * Books a reval the way the entry form does: derive the prefills from history,
 * then hand them to the same payload builder the form submits.
 */
function bookFxReval(
  history: InvestmentTransaction[],
  opts: { id: string; roundName: string; currency: string; newRate: number; date: string; carryingValue: number }
): InvestmentTransaction {
  const priorRate = derivePriorFxRate(history, opts.currency)!
  const localSharePrice = deriveLocalSharePrice(history, opts.currency)
  const positionValueOriginal = deriveOriginalPositionValue(opts.carryingValue, priorRate)!

  return txn({
    id: opts.id,
    transaction_type: 'unrealized_gain_change',
    round_name: opts.roundName,
    transaction_date: opts.date,
    ...buildFxRevaluationPayload({
      currency: opts.currency,
      positionValueOriginal,
      priorRate,
      newRate: opts.newRate,
      localSharePrice,
    }),
  })
}

/** €1.0M at 1 EUR = 1.10 USD -> $1.10M; 500k shares at €2.00 / $2.20. */
const PRICED_EQUITY = txn({
  id: 'a', transaction_type: 'investment', round_name: 'Series A',
  transaction_date: '2025-01-01', investment_cost: 1_100_000, shares_acquired: 500_000,
  share_price: 2.20, original_currency: 'EUR', original_investment_cost: 1_000_000,
  original_share_price: 2.00,
})

describe('FX revaluation through computeSummary', () => {
  it('moves a priced-equity FMV by exactly the FX loss', () => {
    const before = computeSummary([PRICED_EQUITY], 'active', new Date('2025-06-30'))
    expect(before.fmv).toBeCloseTo(1_100_000, 4)

    const reval = bookFxReval([PRICED_EQUITY], {
      id: 'b', roundName: 'Series A', currency: 'EUR', newRate: 1.05,
      date: '2025-06-30', carryingValue: before.unrealizedValue,
    })

    // Prior rate is implied by the share-price pair (2.20 / 2.00), not guessed.
    expect(reval.prior_fx_rate).toBeCloseTo(1.10, 9)
    expect(reval.original_position_value).toBeCloseTo(1_000_000, 4)
    expect(reval.fx_value_change).toBeCloseTo(-50_000, 4)
    expect(reval.current_share_price).toBeCloseTo(2.10, 9)

    const after = computeSummary([PRICED_EQUITY, reval], 'active', new Date('2025-06-30'))
    expect(after.fmv).toBeCloseTo(1_050_000, 4)       // 500k shares x $2.10
    expect(after.fmv - before.fmv).toBeCloseTo(-50_000, 4)
    expect(after.fmv).toBeCloseTo(1_000_000 * 1.05, 4) // local value held, at the new rate
  })

  it('moves a convertible FMV via unrealized_value_change, with no phantom share price', () => {
    const safe = txn({
      id: 'a', transaction_type: 'investment', round_name: 'Seed SAFE',
      transaction_date: '2025-01-01', investment_cost: 500_000, shares_acquired: 0,
      original_currency: 'EUR', original_investment_cost: 454_545.4545,
    })

    const before = computeSummary([safe], 'active', new Date('2025-06-30'))
    expect(before.fmv).toBeCloseTo(500_000, 4)

    const reval = bookFxReval([safe], {
      id: 'b', roundName: 'Seed SAFE', currency: 'EUR', newRate: 1.05,
      date: '2025-06-30', carryingValue: before.unrealizedValue,
    })

    expect(reval.prior_fx_rate).toBeCloseTo(1.10, 6)
    // No local share price exists, so none is invented for other rounds to pick up.
    expect(reval.current_share_price).toBeNull()
    expect(reval.fx_value_change).toBeCloseTo(-22_727.27, 2)

    const after = computeSummary([safe, reval], 'active', new Date('2025-06-30'))
    expect(after.fmv).toBeCloseTo(454_545.4545 * 1.05, 2)
  })

  it('records no change in the local currency', () => {
    const before = computeSummary([PRICED_EQUITY], 'active', new Date('2025-06-30'))
    const reval = bookFxReval([PRICED_EQUITY], {
      id: 'b', roundName: 'Series A', currency: 'EUR', newRate: 1.05,
      date: '2025-06-30', carryingValue: before.unrealizedValue,
    })
    expect(reval.original_unrealized_value_change).toBe(0)
    expect(reval.valuation_change_source).toBe('fx')
  })

  it('treats an unchanged rate as a no-op on FMV', () => {
    const before = computeSummary([PRICED_EQUITY], 'active', new Date('2025-06-30'))
    const reval = bookFxReval([PRICED_EQUITY], {
      id: 'b', roundName: 'Series A', currency: 'EUR', newRate: 1.10,
      date: '2025-06-30', carryingValue: before.unrealizedValue,
    })

    const after = computeSummary([PRICED_EQUITY, reval], 'active', new Date('2025-06-30'))
    expect(reval.fx_value_change).toBeCloseTo(0, 6)
    expect(after.fmv).toBeCloseTo(before.fmv, 4)
  })

  it('chains a second reval off the first rate, not the original cost rate', () => {
    const s0 = computeSummary([PRICED_EQUITY], 'active', new Date('2025-06-30'))
    const r1 = bookFxReval([PRICED_EQUITY], {
      id: 'b', roundName: 'Series A', currency: 'EUR', newRate: 1.05,
      date: '2025-06-30', carryingValue: s0.unrealizedValue,
    })

    const s1 = computeSummary([PRICED_EQUITY, r1], 'active', new Date('2025-09-30'))
    const r2 = bookFxReval([PRICED_EQUITY, r1], {
      id: 'c', roundName: 'Series A', currency: 'EUR', newRate: 1.20,
      date: '2025-09-30', carryingValue: s1.unrealizedValue,
    })

    expect(r2.prior_fx_rate).toBeCloseTo(1.05, 9)      // the explicit fx_rate from r1
    expect(r2.fx_value_change).toBeCloseTo(150_000, 3) // €1.0M x (1.20 - 1.05)

    const s2 = computeSummary([PRICED_EQUITY, r1, r2], 'active', new Date('2025-09-30'))
    expect(s2.fmv).toBeCloseTo(1_200_000, 3)           // €1.0M at 1.20
  })
})
