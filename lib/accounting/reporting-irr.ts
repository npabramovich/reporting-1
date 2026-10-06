import { xirr } from '@/lib/xirr'
import { bucketForSourceType, type CapitalPosting } from './capital-account'
import type { CapitalEvidence } from './capital-evidence'

/** Shared across LP reports, capital statements, fund summaries, and charts. */
export function reportingIrr(postings: CapitalPosting[], nav: number, evidence: CapitalEvidence | undefined): number | null {
  if (!evidence || evidence.missing.length > 0) return null
  if (evidence.basis === 'reported') return evidence.reportedIrr
  if (evidence.conflict) return null
  if (!evidence.canCalculateIrr) return evidence.reportedIrr
  if (!evidence.asOf) return null
  const flows = postings.flatMap(p => {
    const type = bucketForSourceType(p.sourceType)
    return p.entryDate && (type === 'contributions' || type === 'distributions')
      ? [{ date: new Date(p.entryDate + 'T00:00:00Z'), amount: p.amount }] : []
  })
  if (Math.abs(nav) >= 0.005) flows.push({ date: new Date(evidence.asOf + 'T00:00:00Z'), amount: nav })
  return flows.length >= 2 ? xirr(flows) : null
}
