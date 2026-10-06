import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ persist: vi.fn(), provision: vi.fn(), vehicleId: vi.fn() }))
vi.mock('@/lib/accounting/provision-accounts', () => ({ ensureVehicleAccounts: mocks.provision }))
vi.mock('@/lib/accounting/vehicle-id', () => ({ vehicleIdByName: mocks.vehicleId }))
vi.mock('@/lib/accounting/persist', () => ({
  accountIdByCode: async () => new Map([['1300', 'receivable'], ['2300', 'payable']]),
  ensureCapitalAccounts: async (_admin: unknown, _fund: string, _group: string, ids: string[]) => new Map(ids.map(id => [id, `capital-${id}`])),
  persistEntry: mocks.persist,
}))
import { issueCapitalCall } from '@/lib/accounting/capital-calls'
import { declareDistribution } from '@/lib/accounting/distributions'
import { capitalOperationKey, validCapitalDate } from '@/lib/accounting/capital-operation-key'

function fixture() {
  const registers = new Map<string, any>()
  const drafts = new Set<string>()
  let failPublish = false
  const rpc = vi.fn(async (name: string, args: any) => {
    if (name === 'discard_unregistered_capital_drafts') {
      for (const id of args.p_entry_ids) if (![...registers.values()].some(row => row.journal_entry_id === id || row.carry_journal_entry_id === id)) drafts.delete(id)
      return { error: null }
    }
    if (failPublish) { failPublish = false; return { error: { message: 'Simulated transaction failure' } } }
    const row = [...registers.values()].find(row => row.id === args.p_register_id)
    row.status = args.p_kind === 'call' ? 'issued' : 'declared'
    row.lines = args.p_lines
    return { error: null }
  })
  const admin = { rpc, from: vi.fn((table: string) => {
    let key = '', inserted: any
    const q: any = {
      select: () => q,
      eq: (column: string, value: string) => { if (column === 'request_key') key = `${table}:${value}`; return q },
      maybeSingle: async () => ({ data: registers.get(key) ?? null, error: null }),
      insert: (row: any) => { inserted = row; key = `${table}:${row.request_key}`; return q },
      single: async () => {
        if (registers.has(key)) return { data: null, error: { message: 'Duplicate request' } }
        const row = { ...inserted, id: `register-${registers.size}`, lines: [] }
        registers.set(key, row)
        return { data: { id: row.id }, error: null }
      },
    }
    return q
  }) } as any
  mocks.persist.mockImplementation(async () => { const entryId = `entry-${mocks.persist.mock.calls.length}`; drafts.add(entryId); return { entryId } })
  return { admin, registers, drafts, rpc, failNextPublish: () => { failPublish = true } }
}
const call = { callDate: '2026-01-31', dueDate: '2026-02-15', scope: 'per_lp' as const, lines: [{ lpEntityId: 'lp', amount: 80 }] }
const distribution = { distributionDate: '2026-01-31', lines: [{ lpEntityId: 'lp', amount: 80 }] }
beforeEach(() => { vi.clearAllMocks(); mocks.vehicleId.mockResolvedValue('vehicle') })
describe('capital operation retries', () => {
  it.each(['call', 'distribution'])('refuses a %s for an unregistered vehicle before writing anything', async kind => {
    // A null vehicle id is a hole, not a wildcard: request_key cannot be unique across NULL
    // vehicle_ids and the retry lookup cannot match a NULL row, so two retries would each post.
    const f = fixture()
    mocks.vehicleId.mockResolvedValue(null)
    const result = kind === 'call'
      ? await issueCapitalCall(f.admin, 'fund', 'Vehicle', 'user', call)
      : await declareDistribution(f.admin, 'fund', 'Vehicle', 'user', distribution)
    expect(result).toMatchObject({ error: expect.stringContaining('vehicle registry') })
    expect(mocks.provision).not.toHaveBeenCalled()
    expect(mocks.persist).not.toHaveBeenCalled()
    expect(f.registers.size).toBe(0)
    expect(f.drafts.size).toBe(0)
    expect(f.rpc).not.toHaveBeenCalled()
  })

  it.each(['call', 'distribution'])('reuses completed %s requests and resumes failed publication', async kind => {
    const f = fixture()
    const run = () => kind === 'call' ? issueCapitalCall(f.admin, 'fund', 'Vehicle', 'user', call) : declareDistribution(f.admin, 'fund', 'Vehicle', 'user', distribution)
    f.failNextPublish()
    expect(await run()).toHaveProperty('error')
    expect(mocks.persist).toHaveBeenCalledTimes(1)
    const succeeded = await run()
    expect(succeeded).not.toHaveProperty('error')
    expect(await run()).toEqual(succeeded)
    expect(mocks.persist).toHaveBeenCalledTimes(1)
    expect(f.registers.size).toBe(1)
    expect(f.admin.from.mock.calls.map((args: any[]) => args[0])).not.toContain('capital_call_lines')
    expect(f.admin.from.mock.calls.map((args: any[]) => args[0])).not.toContain('distribution_lines')
  })
  it('cleans up the unclaimed draft from concurrent initial requests', async () => {
    const f = fixture()
    const results = await Promise.all([issueCapitalCall(f.admin, 'fund', 'Vehicle', 'user', call), issueCapitalCall(f.admin, 'fund', 'Vehicle', 'user', call)])
    expect(results.filter(result => !('error' in result))).toHaveLength(1)
    expect(f.registers.size).toBe(1)
    expect(f.drafts.size).toBe(1)
    expect(await issueCapitalCall(f.admin, 'fund', 'Vehicle', 'user', call)).not.toHaveProperty('error')
  })
  it('publishes carry-only distributions with one distinct entry id', async () => {
    const f = fixture()
    // `lines: []` is what the route sends for a carry-only declaration.
    expect(await declareDistribution(f.admin, 'fund', 'Vehicle', 'user', { distributionDate: '2026-01-31', lines: [], carryLines: [{ lpEntityId: 'gp', amount: 80 }] })).not.toHaveProperty('error')
    const args = f.rpc.mock.calls.find(([name]) => name === 'complete_capital_operation')![1]
    expect(args.p_entry_ids).toHaveLength(1)
    expect(args.p_lines).toEqual([{ lpEntityId: 'gp', amount: 80, role: 'carry' }])
  })
  it('rejects invalid dates and nonfinite amounts before provisioning', async () => {
    const f = fixture()
    expect(await issueCapitalCall(f.admin, 'fund', 'Vehicle', 'user', { ...call, callDate: '2026-02-30' })).toHaveProperty('error')
    expect(await issueCapitalCall(f.admin, 'fund', 'Vehicle', 'user', { ...call, dueDate: '2026-01-01' })).toHaveProperty('error')
    expect(await declareDistribution(f.admin, 'fund', 'Vehicle', 'user', { ...distribution, lines: [{ lpEntityId: 'lp', amount: Infinity }] })).toHaveProperty('error')
    expect(mocks.provision).not.toHaveBeenCalled()
  })
  it('supports reordered retries and intentional new operations through a nonce', () => {
    const input = { ...call, lines: [...call.lines, { lpEntityId: 'other', amount: 20 }] }
    expect(capitalOperationKey(input)).toBe(capitalOperationKey({ ...input, lines: [...input.lines].reverse() }))
    expect(capitalOperationKey({ ...input, requestKey: 'next' })).not.toBe(capitalOperationKey(input))
    expect(validCapitalDate('2024-02-29')).toBe(true)
    expect(validCapitalDate('2025-02-29')).toBe(false)
  })
})
