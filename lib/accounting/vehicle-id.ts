import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Resolve a vehicle name (or legacy alias) to its fund_vehicles.id. The accounting
 * tables key off this id, so callers keep passing the vehicle name (from the
 * picker) and we resolve it here — a rename changes the registry name, not the
 * ledger rows. Returns null if the fund has no matching vehicle.
 */
export async function vehicleIdByName(admin: SupabaseClient, fundId: string, name: string): Promise<string | null> {
  const { data } = await (admin as any).from('fund_vehicles').select('id').eq('fund_id', fundId).eq('name', name).maybeSingle()
  if (data) return data.id as string
  const { data: alias } = await (admin as any).from('fund_vehicles').select('id').eq('fund_id', fundId).contains('aliases', [name]).maybeSingle()
  return (alias?.id as string) ?? null
}
