import type { SupabaseClient } from '@supabase/supabase-js'
import { chartForVehicleKind } from './chart'
import { vehicleIdByName } from './vehicle-id'
import { vehicleKindByName } from './vehicle-domain'

/** Write operations only. Ignore duplicates atomically; never overwrite customized accounts. */
export async function ensureVehicleAccounts(admin: SupabaseClient, fundId: string, group: string): Promise<void> {
  const [vehicleId, kind] = await Promise.all([
    vehicleIdByName(admin, fundId, group), vehicleKindByName(admin, fundId, group),
  ])
  if (!vehicleId) throw new Error('Unknown entity')
  const chart = chartForVehicleKind(kind)
  const { error } = await admin.from('chart_of_accounts' as any).upsert(chart.map(a => ({
    fund_id: fundId, vehicle_id: vehicleId, portfolio_group: group,
    code: a.code, name: a.name, type: a.type, subtype: a.subtype ?? null,
  })), { onConflict: 'fund_id,portfolio_group,code', ignoreDuplicates: true })
  if (error) throw error
}
