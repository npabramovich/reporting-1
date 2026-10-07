import { describe, it, expect, vi } from 'vitest'
import { draftEntryForTransaction } from './from-portfolio'
import { persistEntry } from './persist'

/**
 * A purchase now waits as a DRAFT for its bank match while marks post. An exit derived in that
 * window must still see the purchase's cost, or a partial exit unwinds the whole accumulated mark
 * (fraction = basis / 0 → 1) and freezes that wrong figure into its entry.
 */
vi.mock('./persist', () => ({
  accountIdByCode: vi.fn(async () => new Map([
    ['1000', 'cash'], ['4000', 'gain'], ['4200', 'unreal-income'], ['4300', 'fx-income'],
  ])),
  persistEntry: vi.fn(async () => ({ entryId: 'exit-1' })),
}))
vi.mock('./vehicle-id', () => ({ vehicleIdByName: vi.fn(async () => 'veh-1') }))
vi.mock('./investments', () => ({
  ensureInvestmentAccounts: vi.fn(async () => new Map([['acme', { costId: 'cost', unrealizedId: 'unreal', fxId: 'fx' }]])),
}))
// Posted: only the +3m mark. The 1m purchase is a draft.
vi.mock('./load', () => ({
  loadPostedLedger: vi.fn(async () => ({ postings: [
    { accountId: 'unreal', amount: 3_000_000 }, { accountId: 'unreal-income', amount: -3_000_000 },
  ] })),
}))

const draftPurchase = [{ id: 'buy', journal_postings: [{ account_id: 'cost', amount: 1_000_000 }, { account_id: 'cash', amount: -1_000_000 }] }]
const admin = {
  from: () => {
    const chain: any = { select: () => chain, eq: () => chain, neq: () => chain, like: () => chain, in: () => chain,
      then: (res: any) => res({ data: draftPurchase, error: null }) }
    return chain
  },
} as any

describe('exit while the purchase still waits for its bank match', () => {
  it('unwinds the mark pro-rata to the cost the derived purchase carries', async () => {
    await draftEntryForTransaction(admin, 'f1', 'u1', {
      id: 'sell', company_id: 'acme', portfolio_group: 'Fund I', transaction_date: '2026-09-30',
      transaction_type: 'proceeds', proceeds_received: 2_000_000, cost_basis_exited: 500_000,
    }, 'Acme')
    const entry = vi.mocked(persistEntry).mock.calls[0][4]
    const unreal = entry.postings.filter(p => p.accountId === 'unreal').reduce((s, p) => s + p.amount, 0)
    expect(unreal).toBe(-1_500_000) // half the position → half the 3m mark, not all of it
  })
})
