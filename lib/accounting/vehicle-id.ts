import type { SupabaseClient } from '@supabase/supabase-js'

/** A resolved name/alias → fund_vehicles.id map for one fund. */
export type VehicleIdMap = Map<string, string>

/**
 * Load every vehicle's name AND aliases → id once, for a fund. The hot report paths
 * (`fundEconomics`, `generateLiveReport`) resolve the same handful of vehicle names 3–4×
 * each across their loaders; passing this map into `vehicleIdByName` turns ~3V per-name
 * lookups into a single fund-wide query. Aliases are indexed too so a legacy name still
 * resolves, exactly as the per-name path does.
 */
export async function loadVehicleIdMap(admin: SupabaseClient, fundId: string): Promise<VehicleIdMap> {
  const { data } = await (admin as any)
    .from('fund_vehicles')
    .select('id, name, aliases')
    .eq('fund_id', fundId)
  const map: VehicleIdMap = new Map()
  for (const v of ((data as any[]) ?? [])) {
    if (v.name) map.set(v.name as string, v.id as string)
    for (const a of ((v.aliases as string[] | null) ?? [])) if (a && !map.has(a)) map.set(a, v.id as string)
  }
  return map
}

/**
 * Resolve a vehicle name (or legacy alias) to its fund_vehicles.id. The accounting
 * tables key off this id, so callers keep passing the vehicle name (from the
 * picker) and we resolve it here — a rename changes the registry name, not the
 * ledger rows. Returns null if the fund has no matching vehicle.
 *
 * Pass `idMap` (from `loadVehicleIdMap`) to resolve from memory and skip the DB — used
 * by the report paths that already loaded the whole fund's vehicles.
 */
export async function vehicleIdByName(
  admin: SupabaseClient,
  fundId: string,
  name: string,
  idMap?: VehicleIdMap,
): Promise<string | null> {
  if (idMap) return idMap.get(name) ?? null
  const { data } = await (admin as any).from('fund_vehicles').select('id').eq('fund_id', fundId).eq('name', name).maybeSingle()
  if (data) return data.id as string
  const { data: alias } = await (admin as any).from('fund_vehicles').select('id').eq('fund_id', fundId).contains('aliases', [name]).maybeSingle()
  return (alias?.id as string) ?? null
}
