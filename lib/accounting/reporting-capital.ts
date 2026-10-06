import type { SupabaseClient } from '@supabase/supabase-js'
import { loadCapitalPostings, type VehicleCapital } from './capital-source'
import { loadOwnership } from './load'
import { loadPositions } from './lp-positions'
import { loadCommitmentEvents, resolveDatedCommitments } from './terms'
import { commitmentEventsForGroup, vehicleCapitalPreload, type FundPreload } from './fund-preload'

export interface ReportingCapital extends VehicleCapital {
  commitmentByLp: Map<string, number>
}

/** Shared evidence and dated commitments for every live capital report. */
export async function loadReportingCapital(
  admin: SupabaseClient,
  fundId: string,
  group: string,
  asOf?: string,
  preload?: FundPreload,
): Promise<ReportingCapital> {
  const idMap = preload?.idMap
  const pre = preload ? vehicleCapitalPreload(preload, group) : undefined
  // A caller can reuse a broader preload for an earlier report date. Do not let future
  // observations enter either the capital postings or the commitment fallback.
  const positions = pre?.positions?.filter(p => !asOf || p.asOfDate <= asOf)
  const ledgerRows = pre?.ledgerRows && asOf
    ? { ...pre.ledgerRows, entryRows: pre.ledgerRows.entryRows.filter(e => e.entry_date <= asOf) }
    : pre?.ledgerRows
  const [capital, events, owners] = await Promise.all([
    loadCapitalPostings(admin, fundId, group, asOf, idMap, pre ? { ...pre, positions, ledgerRows } : undefined),
    loadCommitmentEvents(admin, fundId, group, idMap, preload ? commitmentEventsForGroup(preload, group) : undefined),
    preload ? Promise.resolve(preload.ownershipByGroup.get(group) ?? []) : loadOwnership(admin, fundId, group),
  ])
  const observations = positions ?? await loadPositions(admin, fundId, group, asOf, idMap)
  return {
    ...capital,
    commitmentByLp: resolveDatedCommitments(events, owners, observations, asOf),
  }
}
