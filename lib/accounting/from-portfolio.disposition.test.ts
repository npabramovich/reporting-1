import { describe, it, expect } from 'vitest'
import { postsOnRecord } from './from-portfolio'

/**
 * The books follow the investments (plans/spec-books-follow-investments.md): an entry derived
 * from a tracker row POSTS when it has no cash leg, and waits as a draft for its bank match when
 * it has one. Decided from the postings, not the transaction type — a write-off is a `proceeds`
 * row with no cash, an in-kind reward is `income` with no cash, a pure SAFE conversion is an
 * `investment` with no cash, and none of them can ever be matched to a bank row.
 */
const line = (accountId: string, amount: number) => ({ accountId, amount, currency: 'USD', lpEntityId: null })
const CASH = 'cash-1000'

describe('postsOnRecord', () => {
  it('posts a mark — no cash leg', () => {
    expect(postsOnRecord([line('unreal', 500), line('unreal-income', -500)], CASH)).toBe(true)
  })

  it('drafts a purchase — it credits cash', () => {
    expect(postsOnRecord([line('cost', 1000), line(CASH, -1000)], CASH)).toBe(false)
  })

  it('drafts cash income — it debits cash', () => {
    expect(postsOnRecord([line(CASH, 40), line('dividends', -40)], CASH)).toBe(false)
  })

  it('posts a write-off — an exit with no proceeds has no wire to match', () => {
    expect(postsOnRecord([line('gain', 1000), line('cost', -1000)], CASH)).toBe(true)
  })

  it('posts a pure conversion, drafts one with new cash', () => {
    expect(postsOnRecord([line('cost', 100), line('accrued', -100)], CASH)).toBe(true)
    expect(postsOnRecord([line('cost', 600), line('accrued', -100), line(CASH, -500)], CASH)).toBe(false)
  })

  it('ignores a zero cash line — it moves no money', () => {
    expect(postsOnRecord([line('unreal', 5), line('unreal-income', -5), line(CASH, 0)], CASH)).toBe(true)
  })
})

// ---- Wiring: draftEntryForTransaction hands persistEntry the disposition. ------------------
import { vi, beforeEach } from 'vitest'
import { draftEntryForTransaction } from './from-portfolio'
import { persistEntry } from './persist'

vi.mock('./persist', () => ({
  accountIdByCode: vi.fn(async () => new Map([['1000', 'cash-1000'], ['4200', 'unreal-income'], ['4300', 'fx-income']])),
  persistEntry: vi.fn(async () => ({ entryId: 'e1' })),
}))
vi.mock('./vehicle-id', () => ({ vehicleIdByName: vi.fn(async () => 'veh-1') }))
vi.mock('./investments', () => ({
  ensureInvestmentAccounts: vi.fn(async () => new Map([['co-1', { costId: 'cost', unrealizedId: 'unreal', fxId: 'fx' }]])),
}))

const admin = {} as any
const base = { id: 't1', company_id: 'co-1', portfolio_group: 'Fund I', transaction_date: '2026-06-30' }

describe('draftEntryForTransaction — disposition', () => {
  beforeEach(() => { vi.mocked(persistEntry).mockClear() })

  it('posts a mark and says so', async () => {
    const r = await draftEntryForTransaction(admin, 'f1', 'u1', { ...base, transaction_type: 'unrealized_gain_change', unrealized_value_change: 250 }, 'Acme')
    expect(vi.mocked(persistEntry).mock.calls[0][5]).toBe('posted')
    expect(r).toMatchObject({ drafted: true, posted: true, entryId: 'e1' })
  })

  it('drafts a purchase to wait for its bank match', async () => {
    const r = await draftEntryForTransaction(admin, 'f1', 'u1', { ...base, transaction_type: 'investment', investment_cost: 1000 }, 'Acme')
    expect(vi.mocked(persistEntry).mock.calls[0][5]).toBe('draft')
    expect(r).toMatchObject({ drafted: true, posted: false })
  })

  it('keeps a mark as a draft when its partner allocation fails, rather than losing it', async () => {
    vi.mocked(persistEntry)
      .mockResolvedValueOnce({ error: 'Entry was not posted because its partner allocation failed: No partner participates.', allocationFailed: true } as any)
      .mockResolvedValueOnce({ entryId: 'e2' })
    const r = await draftEntryForTransaction(admin, 'f1', 'u1', { ...base, transaction_type: 'unrealized_gain_change', unrealized_value_change: 250 }, 'Acme')
    expect(vi.mocked(persistEntry).mock.calls.map(c => c[5])).toEqual(['posted', 'draft'])
    expect(r).toMatchObject({ drafted: true, posted: false, entryId: 'e2', reason: expect.stringMatching(/No partner participates/) })
  })

  it('surfaces a closed-period refusal of a mark instead of swallowing it', async () => {
    vi.mocked(persistEntry).mockResolvedValueOnce({ error: 'Period closed through 2026-06-30.' })
    const r = await draftEntryForTransaction(admin, 'f1', 'u1', { ...base, transaction_type: 'unrealized_gain_change', unrealized_value_change: 250 }, 'Acme')
    expect(r).toMatchObject({ drafted: false, reason: 'Period closed through 2026-06-30.' })
  })
})

// ---- Reporting: a batch of derivations, said back to the caller. --------------------------
import { tallyLedgerResults } from './from-portfolio'

describe('tallyLedgerResults', () => {
  it('counts posted and drafted apart, and keeps every refusal with its name', () => {
    const t = tallyLedgerResults([
      { name: 'Acme', result: { drafted: true, posted: true } },
      { name: 'Beta', result: { drafted: true, posted: false } },
      { name: 'Gamma', result: { drafted: false, reason: 'Period closed through 2026-06-30.' } },
    ])
    expect(t).toEqual({ booked: 2, posted: 1, drafted: 1, errors: ['Gamma: Period closed through 2026-06-30.'] })
  })

  it('does not call a vehicle that keeps no books an error', () => {
    const t = tallyLedgerResults([{ name: 'Acme', result: { drafted: false, reason: 'no chart', notOnboarded: true } }])
    expect(t).toEqual({ booked: 0, posted: 0, drafted: 0, errors: [] })
  })
})
