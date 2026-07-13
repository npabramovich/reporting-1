import { describe, it, expect } from 'vitest'
import { buildSoiPositions, txnsForVehicle, type SoiCompany } from './soi'

const co = (over: Partial<SoiCompany> = {}): SoiCompany => ({
  id: 'c1', name: 'Tern Labs, Inc.', status: 'active',
  industry: ['Software'], stage: 'Series B', portfolio_group: ['Tern SPV LP'],
  ...over,
})

// Minimal shape of an investment_transactions row; computeSummary ignores the rest.
const txn = (o: any) => ({
  id: o.id ?? Math.random().toString(36).slice(2),
  company_id: o.company_id ?? 'c1',
  transaction_type: o.transaction_type,
  transaction_date: o.transaction_date ?? '2026-02-02',
  round_name: o.round_name ?? 'Series B',
  investment_cost: o.investment_cost ?? null,
  shares_acquired: o.shares_acquired ?? null,
  share_price: o.share_price ?? null,
  current_share_price: o.current_share_price ?? null,
  unrealized_value_change: o.unrealized_value_change ?? null,
  cost_basis_exited: o.cost_basis_exited ?? null,
  proceeds_received: o.proceeds_received ?? null,
  proceeds_escrow: o.proceeds_escrow ?? null,
  proceeds_written_off: o.proceeds_written_off ?? null,
  interest_converted: o.interest_converted ?? null,
  portfolio_group: o.portfolio_group ?? null,
}) as any

describe('txnsForVehicle', () => {
  it('matches the vehicle EXACTLY — never as a substring', () => {
    // The bug this guards: "Ledgerline SPV II".includes("Ledgerline SPV") is true.
    const txns = [
      txn({ transaction_type: 'investment', portfolio_group: 'Ledgerline SPV', investment_cost: 100 }),
      txn({ transaction_type: 'investment', portfolio_group: 'Ledgerline SPV II', investment_cost: 999 }),
    ]
    const got = txnsForVehicle(txns, 'Ledgerline SPV')
    expect(got).toHaveLength(1)
    expect(got[0].investment_cost).toBe(100)
  })

  it('includes untagged company-wide price signals', () => {
    const txns = [
      txn({ transaction_type: 'investment', portfolio_group: 'Tern SPV LP', investment_cost: 100 }),
      txn({ transaction_type: 'round_info', portfolio_group: null, share_price: 11.3679 }),
      txn({ transaction_type: 'investment', portfolio_group: null, investment_cost: 555 }), // untagged investment: NOT a price signal
    ]
    const got = txnsForVehicle(txns, 'Tern SPV LP')
    expect(got.map(t => t.transaction_type).sort()).toEqual(['investment', 'round_info'])
  })
})

describe('buildSoiPositions', () => {
  it('values priced equity at shares × the latest round price', () => {
    // The real Tern position: 345,585 sh @ $7.9575 cost, marked to $11.3679.
    const positions = buildSoiPositions(
      [
        txn({ transaction_type: 'investment', portfolio_group: 'Tern SPV LP', investment_cost: 2_700_000.00, shares_acquired: 345_585, share_price: 7.9575 }),
        txn({ transaction_type: 'round_info', portfolio_group: null, share_price: 11.3679 }),
      ],
      [co()],
      'Tern SPV LP',
    )
    expect(positions).toHaveLength(1)
    const p = positions[0]
    expect(p.name).toBe('Tern Labs, Inc.')
    expect(p.shares).toBe(345_585)
    expect(p.sharePrice).toBe(11.3679)
    expect(p.cost).toBe(2_700_000.00)
    expect(p.fairValue).toBe(3_900_000.00) // 345,585 × 11.3679
    expect(p.unrealized).toBe(1_200_000.00)
    expect(p.assetType).toBe('Priced equity')
    expect(p.industry).toBe('Software')
  })

  it('excludes a company the vehicle does not hold', () => {
    const positions = buildSoiPositions(
      [txn({ transaction_type: 'investment', portfolio_group: 'Some Other Fund, LP', investment_cost: 500_000, shares_acquired: 100, share_price: 5000 })],
      [co()],
      'Tern SPV LP',
    )
    expect(positions).toEqual([])
  })

  it('does not create a position from a price signal alone', () => {
    const positions = buildSoiPositions(
      [txn({ transaction_type: 'round_info', portfolio_group: null, share_price: 11.3679 })],
      [co()],
      'Tern SPV LP',
    )
    expect(positions).toEqual([])
  })

  it('values an unpriced SAFE at cost plus its cumulative value change', () => {
    const positions = buildSoiPositions(
      [
        txn({ transaction_type: 'investment', portfolio_group: 'Tern SPV LP', investment_cost: 250_000, shares_acquired: 0, share_price: 0, round_name: 'SAFE' }),
        txn({ transaction_type: 'unrealized_gain_change', portfolio_group: 'Tern SPV LP', unrealized_value_change: 50_000, round_name: 'SAFE' }),
      ],
      [co()],
      'Tern SPV LP',
    )
    expect(positions[0].fairValue).toBe(300_000)
    expect(positions[0].assetType).toBe('Convertible / SAFE')
  })
})
