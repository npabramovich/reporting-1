import type { SupabaseClient } from '@supabase/supabase-js'
import type { AccessContext } from '@/lib/access/effective'
import { hasAccess } from '@/lib/access/effective'
import { canSeeVehicle } from '@/lib/access/scope'
import { fundEconomics, type VehicleEconomics } from '@/lib/accounting/fund-economics'
import { fundTimeseries, type FundTimeseries } from '@/lib/accounting/fund-timeseries'

/**
 * The carry and GP-class figures are gp_economics. Everything else on the fund overview is
 * ordinary accounting, and the `lp` metrics are already net-to-LP with the carry removed, so a
 * bookkeeper still gets a complete, correct picture without the GP's economics in it.
 *
 * OMITTED, not zeroed: `carryAccrued: 0` would read as "no carry has accrued", which is a lie
 * rather than a redaction.
 */
export function withoutGpEconomics(vehicles: VehicleEconomics[], access: AccessContext) {
  if (hasAccess(access, 'gp_economics', 'read')) return vehicles
  return vehicles.map(({ gp: _gp, carryAccrued: _carry, ...rest }) => rest)
}

export interface FundDetailInitial {
  /** Exactly what GET /api/accounting/fund-economics?group=<vehicle> returns under `vehicles`. */
  vehicles: unknown[]
  /** Exactly what GET /api/accounting/fund-timeseries?group=<vehicle> returns, or null on failure. */
  timeseries: unknown | null
}

/**
 * The entity lead page's first data, loaded with the page instead of by two /api calls after it
 * arrives (each of which ran the whole proxy gate again). The page streams it to the client view
 * as a promise, so the header renders at once and the figures follow in the same response.
 *
 * The caller has already passed the page gate for this vehicle (requireVehicleAccess: accounting
 * read and the entity), which is what the two routes check. Null on failure, and the view then
 * falls back to fetching, so a loader error is never worse than before.
 */
export async function loadFundDetailInitial(
  admin: SupabaseClient,
  fundId: string,
  access: AccessContext,
  vehicle: string,
): Promise<FundDetailInitial | null> {
  try {
    const [econ, timeseries] = await Promise.all([
      fundEconomics(admin as any, fundId, undefined, [vehicle]),
      fundTimeseries(admin as any, fundId, vehicle).catch(() => null as FundTimeseries | null),
    ])
    const visible = withoutGpEconomics(econ.filter(v => canSeeVehicle(access, v.id)), access)
    // The same JSON the routes send, so the view cannot tell the difference.
    return JSON.parse(JSON.stringify({ vehicles: visible, timeseries }))
  } catch {
    return null
  }
}
