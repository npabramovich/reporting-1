import type { CapitalPosting } from './capital-account'
import { computeCapitalAccounts, emptyAccount } from './capital-account'
import { positionsToPostings, type LpPosition } from './lp-positions'

export const REPORTING_DEFINITION_VERSION = 'capital-v1'
export interface ReviewedPeriod { start: string; end: string }

/** All days from the observation through the report must be reviewed, with no gaps. */
export function coversReportingInterval(periods: ReviewedPeriod[], start: string, end: string): boolean {
  let next = start
  for (const period of [...periods].sort((a, b) => a.start.localeCompare(b.start))) {
    if (period.end < next) continue
    if (period.start > next) return false
    if (period.end >= end) return true
    const day = new Date(`${period.end}T00:00:00Z`)
    day.setUTCDate(day.getUTCDate() + 1)
    next = day.toISOString().slice(0, 10)
  }
  return false
}

export interface CapitalEvidence {
  values: { contributions: number | null; distributions: number | null; nav: number | null }
  basis: 'reported' | 'ledger' | 'missing'
  asOf: string | null
  reportedIrr: number | null
  canCalculateIrr: boolean
  missing: ('contributions' | 'distributions' | 'nav')[]
  conflict: boolean
  ledgerThrough: string | null
  /** Observations describe balances, not transaction dates. */
  observationDates: string[]
  entryIds: string[]
  anchor?: { positionId: string | null; date: string; agreesWithBooks: boolean; supportingEntryIds: string[] }
}

/** Resolve each partner independently. A chart or an unrelated entry cannot select a source.
 * Observations and postings are alternate representations; they are never added together.
 * A closed period supplies the explicit book-review boundary for using subsequent activity.
 */
export function resolveCapitalEvidence(
  ledger: CapitalPosting[], positions: LpPosition[], asOf?: string, closedThrough?: string | null, reviewedPeriods?: ReviewedPeriod[],
): { postings: CapitalPosting[]; evidenceByLp: Map<string, CapitalEvidence> } {
  const scopedLedger = ledger.filter(p => !asOf || (!!p.entryDate && p.entryDate <= asOf))
  const scopedPositions = positions.filter(p => !asOf || p.asOfDate <= asOf)
  const ids = new Set([...scopedLedger.map(p => p.lpEntityId), ...scopedPositions.map(p => p.lpEntityId)].filter(Boolean) as string[])
  const postings: CapitalPosting[] = []
  const evidenceByLp = new Map<string, CapitalEvidence>()
  for (const id of ids) {
    const lpLedger = scopedLedger.filter(p => p.lpEntityId === id)
    if (new Set(lpLedger.map(p => p.currency).filter(Boolean)).size > 1) throw new Error(`Multiple currencies in capital records for ${id}; translate them to one reporting currency before reporting.`)
    const observations = scopedPositions.filter(p => p.lpEntityId === id).sort((a, b) => a.asOfDate.localeCompare(b.asOfDate))
    const latest = observations.at(-1)
    const ledgerThrough = lpLedger.reduce<string | null>((date, p) => p.entryDate && (!date || p.entryDate > date) ? p.entryDate : date, null)
    const missing: CapitalEvidence['missing'] = []
    if (latest?.calledCapital == null && latest) missing.push('contributions')
    if (latest?.distributions == null && latest) missing.push('distributions')
    if (latest?.nav == null && latest) missing.push('nav')
    const atObservation = latest ? computeCapitalAccounts(lpLedger, { end: latest.asOfDate }).get(id) ?? emptyAccount() : null
    const ties = !!latest && missing.length === 0 && !!atObservation &&
      Math.abs(atObservation.contributions - latest.calledCapital!) < 0.005 &&
      Math.abs(-atObservation.distributions - latest.distributions!) < 0.005 &&
      Math.abs(atObservation.ending - latest.nav!) < 0.005
    const reportDate = asOf ?? [ledgerThrough, latest?.asOfDate].filter(Boolean).sort().at(-1)
    const reviewed = !!reportDate && (reviewedPeriods !== undefined
      ? !!latest && coversReportingInterval(reviewedPeriods, latest.asOfDate, reportDate)
      : !!closedThrough && closedThrough >= reportDate)
    const useLedger = !latest || (ties && reviewed)
    const basis = useLedger ? 'ledger' : 'reported'
    if (useLedger) postings.push(...lpLedger)
    // Numeric compatibility postings exist only for COMPLETE observations; metadata retains
    // missing fields. Never synthesize a zero NAV from a partial statement.
    else if (missing.length === 0) postings.push(...positionsToPostings(observations.filter(p => p.calledCapital != null && p.distributions != null && p.nav != null)))
    const openingOnly = lpLedger.some(p => /opening|bootstrap|cutover/.test(p.sourceType ?? ''))
    const balance = computeCapitalAccounts(lpLedger).get(id) ?? emptyAccount()
    evidenceByLp.set(id, {
      values: useLedger ? { contributions: balance.contributions, distributions: -balance.distributions, nav: balance.ending } : { contributions: latest!.calledCapital, distributions: latest!.distributions, nav: latest!.nav },
      basis, asOf: useLedger ? (asOf ?? ledgerThrough) : latest!.asOfDate,
      reportedIrr: latest?.irr ?? null,
      canCalculateIrr: useLedger && !openingOnly && lpLedger.length > 0,
      missing, conflict: !!latest && lpLedger.length > 0 && !!atObservation && (
        (latest.calledCapital != null && Math.abs(atObservation.contributions - latest.calledCapital) >= 0.005) ||
        (latest.distributions != null && Math.abs(-atObservation.distributions - latest.distributions) >= 0.005) ||
        (latest.nav != null && Math.abs(atObservation.ending - latest.nav) >= 0.005)
      ),
      ledgerThrough, observationDates: observations.map(p => p.asOfDate),
      ...(latest ? { anchor: { positionId: latest.id ?? null, date: latest.asOfDate, agreesWithBooks: ties, supportingEntryIds: Array.from(new Set(lpLedger.filter(p => p.entryDate && p.entryDate <= latest.asOfDate).map(p => p.entryId).filter((id): id is string => !!id))) } } : {}),
      entryIds: Array.from(new Set(lpLedger.map(p => p.entryId).filter((id): id is string => !!id))),
    })
  }
  return { postings, evidenceByLp }
}
