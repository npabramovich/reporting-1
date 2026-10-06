import { describe, expect, it } from 'vitest'
import { resolveCarryPaid } from './carry-paid'
const posting = { entryId: 'journal', lpEntityId: 'lp', entryDate: '2025-01-01', sourceType: 'carry_distribution', amount: 10 }
function db(payments: object[]) {
  const q: any = { select: () => q, eq: () => q, order: async () => ({ data: payments, error: null }) }
  return { from: () => q } as any
}
const payment = { id: 'payment', lp_entity_id: 'lp', paid_date: '2025-01-01', amount: 10 }
const opts = { source: 'mixed' as const, ownPostings: [posting], fundId: 'firm', vehicleId: 'vehicle' }
describe('carry representations', () => {
  it('counts an explicitly linked register and journal representation only once', async () => {
    const r = await resolveCarryPaid(db([{ ...payment, journal_entry_id: 'journal' }]), opts)
    expect(r.paidByLp.get('lp')).toBe(10)
    expect(r.unresolvedLpIds.size).toBe(0)
  })
  it('requires reconciliation of a possible duplicate rather than publishing the combined total', async () => {
    const r = await resolveCarryPaid(db([payment]), opts)
    expect(r.unresolvedLpIds.has('lp')).toBe(true)
    expect(r.payments[0].possibleEntryIds).toEqual(['journal'])
  })
  it('counts two confirmed separate payments', async () => {
    const r = await resolveCarryPaid(db([{ ...payment, separate_from_ledger: true }]), opts)
    expect(r.paidByLp.get('lp')).toBe(20)
    expect(r.unresolvedLpIds.size).toBe(0)
  })
  it('does not include future register or journal payments in an earlier report', async () => {
    const r = await resolveCarryPaid(db([payment]), { ...opts, asOf: '2024-12-31' })
    expect(r.paidByLp.size).toBe(0)
  })
})
