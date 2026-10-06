import { describe, expect, it, vi } from 'vitest'
import { ensureVehicleAccounts } from './provision-accounts'
vi.mock('./vehicle-id', () => ({ vehicleIdByName: async () => 'vehicle' }))
vi.mock('./vehicle-domain', () => ({ vehicleKindByName: async () => 'manco' }))
describe('account provisioning', () => {
  it('uses a database conflict key for concurrent retries and preserves custom account names', async () => {
    const saved = new Map<string, any>([['1000', { code: '1000', name: 'Custom operating cash' }]])
    const upsert = vi.fn(async (rows: any[], options: any) => {
      expect(options).toEqual({ onConflict: 'fund_id,portfolio_group,code', ignoreDuplicates: true })
      for (const row of rows) if (!saved.has(row.code)) saved.set(row.code, row)
      return { error: null }
    })
    const admin = { from: (table: string) => { expect(table).toBe('chart_of_accounts'); return { upsert } } } as any
    await Promise.all([ensureVehicleAccounts(admin, 'firm', 'Management LLC'), ensureVehicleAccounts(admin, 'firm', 'Management LLC')])
    expect(saved.get('1000').name).toBe('Custom operating cash')
    expect(Array.from(saved.values()).filter(r => r.code !== '1000').every(r => r.fund_id === 'firm' && r.vehicle_id === 'vehicle')).toBe(true)
    expect(Array.from(saved.values()).some(r => r.subtype === 'members_capital')).toBe(true)
  })
})
