import { describe, it, expect } from 'vitest'
import { loadFundPreload, sourceForGroup } from './fund-preload'

// Fake admin client: a chainable query builder where every method returns the same thenable,
// which resolves to the table's canned rows. Filters are no-ops (the loaders group/reduce in
// memory, which is what we're testing). Supports the preload's reads AND the batch loaders'
// `.in()/.lte()` chains.
function fakeAdmin(tables: Record<string, any[]>): any {
  const makeQ = (table: string) => {
    const rows = tables[table] ?? []
    const q: any = {
      select: () => q, eq: () => q, in: () => q, lte: () => q, order: () => q, contains: () => q, range: () => q,
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      then: (resolve: (v: any) => any) => resolve({ data: rows, error: null }),
    }
    return q
  }
  return { from: (table: string) => makeQ(table) }
}

const FUND = 'fund-1'

describe('loadFundPreload', () => {
  it('builds the id map from names AND aliases, and reads vintage from the same rows', async () => {
    const admin = fakeAdmin({
      fund_vehicles: [
        { id: 'v1', name: 'Main Fund', aliases: ['Main Fund LP', 'MF'], vintage_year: 2021 },
        { id: 'v2', name: 'SPV One', aliases: null, vintage_year: null },
      ],
      lp_entities: [],
      lp_investments: [],
      vehicle_accounting_settings: [],
    })
    const p = await loadFundPreload(admin, FUND)
    expect(p.idMap.get('Main Fund')).toBe('v1')
    expect(p.idMap.get('Main Fund LP')).toBe('v1') // alias resolves
    expect(p.idMap.get('MF')).toBe('v1')
    expect(p.idMap.get('SPV One')).toBe('v2')
    expect(p.vintageByName.get('Main Fund')).toBe(2021)
    expect(p.vintageByName.get('SPV One')).toBeNull()
  })

  it('names entities and defaults a missing partner_class to lp', async () => {
    const admin = fakeAdmin({
      fund_vehicles: [],
      lp_entities: [
        { id: 'e1', entity_name: 'Alice LP', partner_class: 'lp' },
        { id: 'e2', entity_name: 'GP Co', partner_class: 'gp' },
        { id: 'e3', entity_name: null, partner_class: null },
      ],
      lp_investments: [],
      vehicle_accounting_settings: [],
    })
    const p = await loadFundPreload(admin, FUND)
    expect(p.entityNames.get('e1')).toBe('Alice LP')
    expect(p.entityNames.get('e3')).toBe('e3') // falls back to id when unnamed
    expect(p.entityClasses.get('e2')).toBe('gp')
    expect(p.entityClasses.get('e3')).toBe('lp') // default
  })

  it('groups investments by vehicle and reduces each to current ownership (snapshot beats unsnapshotted)', async () => {
    const admin = fakeAdmin({
      fund_vehicles: [],
      lp_entities: [],
      lp_investments: [
        // Two rows for the same entity in Main Fund: the snapshotted one wins.
        { entity_id: 'e1', portfolio_group: 'Main Fund', commitment: 100, paid_in_capital: 10, distributions: 0, snapshot_id: null, updated_at: '2024-01-01' },
        { entity_id: 'e1', portfolio_group: 'Main Fund', commitment: 100, paid_in_capital: 40, distributions: 5, snapshot_id: 's1', updated_at: '2023-01-01', lp_snapshots: { as_of_date: '2024-06-30', created_at: '2024-07-01' } },
        { entity_id: 'e2', portfolio_group: 'SPV One', commitment: 50, paid_in_capital: 50, distributions: 0, snapshot_id: null, updated_at: '2024-01-01' },
      ],
      vehicle_accounting_settings: [],
    })
    const p = await loadFundPreload(admin, FUND)
    const main = p.ownershipByGroup.get('Main Fund')!
    expect(main).toHaveLength(1)
    expect(main[0]).toMatchObject({ lpEntityId: 'e1', paidIn: 40, distributions: 5 }) // snapshotted row won
    expect(p.ownershipByGroup.get('SPV One')).toHaveLength(1)
    expect(p.ownershipByGroup.has('nonexistent')).toBe(false)
  })

  it('maps capital source per vehicle and defaults unknown/absent to events', async () => {
    const admin = fakeAdmin({
      fund_vehicles: [
        { id: 'v1', name: 'Main Fund', aliases: null, vintage_year: null },
        { id: 'v2', name: 'SPV One', aliases: null, vintage_year: null },
        { id: 'v3', name: 'Tracked', aliases: null, vintage_year: null },
      ],
      lp_entities: [],
      lp_investments: [],
      vehicle_accounting_settings: [
        { vehicle_id: 'v1', capital_source: 'ledger' },
        { vehicle_id: 'v2', capital_source: 'events' },
        // v3 has no settings row → defaults to events.
      ],
    })
    const p = await loadFundPreload(admin, FUND)
    expect(sourceForGroup(p, 'Main Fund')).toBe('ledger')
    expect(sourceForGroup(p, 'SPV One')).toBe('events')
    expect(sourceForGroup(p, 'Tracked')).toBe('events') // no settings row
    expect(sourceForGroup(p, 'Unknown Vehicle')).toBe('events') // not in id map
  })
})
