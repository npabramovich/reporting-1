import { describe, it, expect } from 'vitest'
import { dealHistories, realizedCapitalFactor } from './realized-capital'
import type { CapitalPosting } from './capital-account'

const txn = (t: Partial<Parameters<typeof dealHistories>[0][number]>) => ({
  company_id: 'acme', portfolio_group: 'Example Fund I', transaction_type: 'investment', transaction_date: '2024-01-01', ...t,
})

describe('dealHistories', () => {
  it('reads investments and realizations for the vehicle, as at the date', () => {
    const deals = dealHistories([
      txn({ investment_cost: 100, fee_amount: 2 }),
      txn({ transaction_type: 'proceeds', transaction_date: '2025-01-01', cost_basis_exited: -60 }),
      txn({ transaction_type: 'proceeds', transaction_date: '2026-01-01', cost_basis_exited: null }), // after asOf
      txn({ company_id: 'other', portfolio_group: 'Another Fund', investment_cost: 500 }),
    ], [{ id: 'acme', status: 'active' }], 'Example Fund I', '2025-06-30')
    expect(deals).toEqual([{
      companyId: 'acme',
      investments: [{ date: '2024-01-01', amount: 102 }],
      realizations: [{ date: '2025-01-01', costExited: 60 }],
      closedOn: null,
    }])
  })

  it('closes a written-off deal on its last transaction date', () => {
    const deals = dealHistories([
      txn({ company_id: 'northwind', investment_cost: 50 }),
      txn({ company_id: 'northwind', transaction_type: 'unrealized_gain_change', transaction_date: '2024-09-30' }),
    ], [{ id: 'northwind', status: 'written-off' }], 'Example Fund I', '2025-06-30')
    expect(deals[0].closedOn).toBe('2024-09-30')
  })
})

describe('realizedCapitalFactor', () => {
  it('is the LP share of contributions, grossed up by expenses over cost', () => {
    const postings: CapitalPosting[] = [
      { lpEntityId: 'lp', amount: -900, sourceType: 'capital_call', entryDate: '2024-01-01' },
      { lpEntityId: 'gp', amount: -100, sourceType: 'capital_call', entryDate: '2024-01-01' },
      { lpEntityId: 'lp', amount: 72, sourceType: 'management_fee', entryDate: '2024-12-31' },
      { lpEntityId: 'gp', amount: 8, sourceType: 'management_fee', entryDate: '2024-12-31' },
    ]
    const deals = [{ companyId: 'acme', investments: [{ date: '2024-01-01', amount: 800 }], realizations: [] }]
    // 90% of the capital is the LPs'; 80 of fees on 800 of cost is a 10% load.
    expect(realizedCapitalFactor(postings, new Set(['gp']), deals, '2025-06-30')).toBeCloseTo(0.99, 10)
  })
})
