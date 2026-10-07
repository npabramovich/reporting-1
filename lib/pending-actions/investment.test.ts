import { describe, it, expect } from 'vitest'
import { ledgerEffectText } from './investment'

// What the approval card promises the ledger will do. It must match postsOnRecord: an entry with
// no cash leg posts, one that moves cash drafts and waits for its bank match.
describe('ledgerEffectText', () => {
  const base = { company: 'Acme', vehicle: 'Fund I', transaction_date: '2026-06-30' }

  it('posts a mark', () => {
    expect(ledgerEffectText({ ...base, transaction_type: 'unrealized_gain_change', unrealized_value_change: 5 })).toMatch(/^Posts/)
  })

  it('posts a write-off — an exit with no proceeds moves no cash', () => {
    expect(ledgerEffectText({ ...base, transaction_type: 'proceeds', proceeds_received: 0, cost_basis_exited: 100 })).toMatch(/^Posts/)
  })

  it('posts a pure conversion — no new cash at the round', () => {
    expect(ledgerEffectText({ ...base, transaction_type: 'investment', converts_from_txn_id: 'x', investment_cost: 0 })).toMatch(/^Posts/)
  })

  it('drafts a purchase until its bank match', () => {
    expect(ledgerEffectText({ ...base, transaction_type: 'investment', investment_cost: 1000 })).toMatch(/^Drafts.*bank/)
  })

  it('drafts an exit with proceeds until its bank match', () => {
    expect(ledgerEffectText({ ...base, transaction_type: 'proceeds', proceeds_received: 500 })).toMatch(/^Drafts.*bank/)
  })

  it('books nothing for a round', () => {
    expect(ledgerEffectText({ ...base, transaction_type: 'round_info' })).toMatch(/^Books nothing/)
  })
})
