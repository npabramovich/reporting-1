// Where does a vehicle's LP capital data come from?
//
// `computeCapitalAccounts()` is a pure function over `CapitalPosting[]` — it has no idea
// whether those postings came from a double-entry ledger or from a spreadsheet. That makes
// `CapitalPosting[]` the seam: give it a second producer and every downstream consumer
// (roll-forward, statement PDF, portal figures, live capital report) works identically for
// a fully-booked fund and for an SPV nobody keeps books on.
//
// Two producers, and a vehicle uses exactly ONE:
//   'ledger' — posted journal_postings on LP capital accounts. The double-entry path.
//   'events' — CAPITAL TRACKING. Reads dated cumulative positions (lp_positions) and derives
//              movements from them at read time (lib/accounting/lp-positions.ts). The name
//              'events' is kept for the stored capital_source value, but a tracking vehicle's
//              truth is its positions, not a movement log.
//
// Reading both and merging would double every LP's capital the moment a vehicle had any of
// each, so the source is stored explicitly on vehicle_accounting_settings rather than
// inferred from "does a chart exist?".
//
// (The legacy lp_capital_events table is no longer read here — positions superseded it. Its
// data was itself derived from the same snapshots the positions were backfilled from.)

import type { SupabaseClient } from '@supabase/supabase-js'
import type { CapitalPosting } from './capital-account'
import { loadPostedLedger, type LedgerRows } from './load'
import { vehicleIdByName, type VehicleIdMap } from './vehicle-id'
import { RECEIVABLE_CODE } from './chart'
import { roundCents } from './ledger'
import { loadPositionPostings, type LpPosition } from './lp-positions'

export type CapitalSource = 'ledger' | 'events'

/**
 * Which producer this vehicle reads from.
 *
 * Defaults to 'events' when unset — a vehicle with no settings row has never been
 * onboarded to the ledger, so its books are empty and 'ledger' could only ever report
 * zeros. 'events' at least reports what someone entered.
 */
export async function loadCapitalSource(
  admin: SupabaseClient,
  fundId: string,
  group: string,
  idMap?: VehicleIdMap
): Promise<CapitalSource> {
  const vehicleId = await vehicleIdByName(admin, fundId, group, idMap)
  if (!vehicleId) return 'events'
  const { data } = await admin
    .from('vehicle_accounting_settings' as any)
    .select('capital_source')
    .eq('fund_id', fundId)
    .eq('vehicle_id', vehicleId)
    .maybeSingle()
  return (data as any)?.capital_source === 'ledger' ? 'ledger' : 'events'
}

export interface VehicleCapital {
  source: CapitalSource
  postings: CapitalPosting[]
  /**
   * Per-LP balance on the "Due from LPs" receivable (1300) — capital that has been CALLED
   * but not yet WIRED. `funded = called - receivable`.
   *
   * Always empty for an events vehicle: recognize-at-call is a double-entry construct, so
   * an event-sourced vehicle has no receivable staging. An event is recorded when the money
   * moves, which makes called and funded the same thing there. That is a real modelling
   * difference, not a gap — do not try to synthesise a receivable for it.
   */
  receivableByLp: Map<string, number>
}

/** Per-LP balance on the receivable account. Pure, so the ledger is loaded only once. */
export function receivablesFromLedger(
  accounts: { id: string; code: string }[],
  postings: { accountId: string; amount: number; lpEntityId?: string | null }[]
): Map<string, number> {
  const out = new Map<string, number>()
  const receivable = accounts.find(a => a.code === RECEIVABLE_CODE)
  if (!receivable) return out
  for (const p of postings) {
    if (p.accountId !== receivable.id || !p.lpEntityId) continue
    out.set(p.lpEntityId, roundCents((out.get(p.lpEntityId) ?? 0) + p.amount))
  }
  return out
}

/**
 * A vehicle's LP capital data, from whichever producer it uses. This is what an LP-capital
 * consumer should call instead of reaching for `loadPostedLedger` directly — doing so is
 * exactly what limits a report to booked vehicles only.
 *
 * `asOf` (ISO date, inclusive) scopes to activity on or before that date, so a report can
 * be generated as of any point in time from either source.
 */
/**
 * Preloaded per-vehicle inputs (from a FundPreload) that let `loadCapitalPostings` skip its
 * queries: the resolved capital `source`, the batched ledger `ledgerRows`, and the batched
 * `positions`. Any subset may be present; a missing piece falls back to a query.
 */
export interface VehicleCapitalPreload {
  source?: CapitalSource
  ledgerRows?: LedgerRows
  positions?: LpPosition[]
}

export async function loadCapitalPostings(
  admin: SupabaseClient,
  fundId: string,
  group: string,
  asOf?: string,
  idMap?: VehicleIdMap,
  pre?: VehicleCapitalPreload
): Promise<VehicleCapital> {
  // A preloaded `source` skips the per-vehicle vehicle_accounting_settings read; preloaded
  // `ledgerRows`/`positions` skip the ledger/position queries (batched once, fund-wide).
  const source = pre?.source ?? await loadCapitalSource(admin, fundId, group, idMap)
  if (source === 'ledger') {
    const { accounts, postings, capitalPostings } = await loadPostedLedger(admin, fundId, group, asOf, idMap, pre?.ledgerRows)
    return { source, postings: capitalPostings, receivableByLp: receivablesFromLedger(accounts, postings) }
  }
  // Capital tracking: derive movements from the vehicle's dated positions.
  return {
    source,
    postings: await loadPositionPostings(admin, fundId, group, asOf, idMap, pre?.positions),
    receivableByLp: new Map(),
  }
}
