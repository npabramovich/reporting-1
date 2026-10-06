import { describe, expect, it } from 'vitest'
import { clearQuickBooksMatch, quickBooksCandidates, readAll, type QuickBooksCashEntry } from './bank-quickbooks-match'

const row = { date: '2026-10-06', amount: -100, description: 'Acme software subscription' }
const entry: QuickBooksCashEntry = { id: 'qb1', date: '2026-10-05', amount: -100, memo: 'Expense 42 — Acme software subscription', status: 'posted' }

describe('bank / QuickBooks duplicate matching', () => {
  it('links a unique posted match with the same amount and descriptive text', () => {
    expect(clearQuickBooksMatch(row, quickBooksCandidates(row, [entry]))?.id).toBe('qb1')
  })
  it('holds amount-only, generic descriptions, and multiple candidates for review', () => {
    expect(clearQuickBooksMatch({ ...row, description: 'ACH withdrawal' }, [entry])).toBeNull()
    expect(clearQuickBooksMatch({ ...row, description: 'wire transfer' }, [{ ...entry, memo: 'wire transfer' }])).toBeNull()
    expect(clearQuickBooksMatch(row, [entry, { ...entry, id: 'qb2' }])).toBeNull()
  })
  it('does not match the opposite cash direction, different amount, or distant dates', () => {
    expect(quickBooksCandidates(row, [{ ...entry, amount: 100 }, { ...entry, amount: -101 }, { ...entry, date: '2026-09-01' }])).toEqual([])
  })
  it('holds drafts rather than posting QuickBooks on bank import', () => {
    expect(clearQuickBooksMatch(row, [{ ...entry, status: 'draft' }])).toBeNull()
  })
  it('paginates the duplicate index and fails closed on a read error', async () => {
    const pages: number[] = []
    expect(await readAll(async from => { pages.push(from); return { data: from === 0 ? Array(1000).fill(1) : [2], error: null } })).toHaveLength(1001)
    expect(pages).toEqual([0, 1000])
    await expect(readAll(async () => ({ data: null, error: { message: 'offline' } }))).rejects.toThrow('offline')
  })
})
