import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/accounting/agent-tools', () => ({
  resolveVehicle: async (_a: any, _f: string, g: string) => g ?? 'V1',
}))
vi.mock('@/lib/accounting/load', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  loadOwnership: async () => [
    { lpEntityId: 'lp1', commitment: 60 },
    { lpEntityId: 'lp2', commitment: 40 },
  ],
  loadEntityNames: async () => new Map([['lp1', 'Alpha LP'], ['lp2', 'Beta LP']]),
}))

import { previewIssueCapitalCall } from '@/lib/pending-actions/capital-call'

describe('capital-call action preview', () => {
  it('splits a call pro-rata by commitment and totals correctly, writing nothing', async () => {
    const p = await previewIssueCapitalCall(
      { admin: {} as any, fundId: 'f1', userId: 'u1', access: {} as any },
      { vehicle: 'V1', callDate: '2026-07-01', total: 1_000_000 },
    )
    expect(p.details.total).toBe(1_000_000)
    const perLp = p.details.perLp as Array<{ lp: string; commitment: number; amount: number }>
    expect(perLp).toHaveLength(2)
    const byName = Object.fromEntries(perLp.map(x => [x.lp, x.amount]))
    expect(byName['Alpha LP']).toBe(600_000)
    expect(byName['Beta LP']).toBe(400_000)
    // commitments surfaced for the approver
    expect(perLp.find(x => x.lp === 'Alpha LP')?.commitment).toBe(60)
  })
})
