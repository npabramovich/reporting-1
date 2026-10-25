// Recycling, staged for a person to approve: what set_recycling_terms, record_recycling and
// remove_recycling stage (their manifests' `stagesAs`). Applied through lib/accounting/recycling.ts,
// the one write path, so an approved proposal is checked exactly as it would be at the time.
//
// The preview is what the approver decides on: the terms before and after, or the amount against
// the cap with each partner's share of a deemed amount.

import type { ActionDeps, PreviewResult } from './types'
import { resolveVehicle } from '@/lib/accounting/vehicle-resolver'
import { loadEntityNames } from '@/lib/accounting/load'
import {
  checkRecycling,
  loadRecyclingTerms,
  parseRecyclingTerms,
  recordRecycling,
  recyclingStatus,
  removeRecycling,
  saveRecyclingTerms,
  TREATMENT_LABEL,
  type RecordRecyclingInput,
  type RecyclingTermsInput,
} from '@/lib/accounting/recycling'
import type { RecyclingTerms } from '@portfolio/fund-engine'

type WithVehicle<T> = T & { vehicle?: string; explanation?: string }

const pct = (n: number) => `${+(n * 100).toFixed(4)}%`
const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** The terms in words, the way the summary line and the approver read them. */
export function describeRecyclingTerms(t: RecyclingTerms): string {
  if (!(t.capRate > 0)) return 'no recycling'
  const basis = t.capBasis === 'management_fees' ? 'of management fees' : 'of commitments'
  const until = t.until ? ` until ${t.until}` : ''
  const uses = t.uses === 'new_investments' ? ', for new investments only' : t.uses === 'follow_ons' ? ', for follow-ons only' : ''
  return `up to ${pct(t.capRate)} ${basis}${until}${uses}, ${TREATMENT_LABEL[t.defaultTreatment ?? 'retained']} by default`
}

const vehicleOf = (deps: ActionDeps, input: { vehicle?: string }) => resolveVehicle(deps.admin, deps.fundId, input?.vehicle, { access: deps.access })
const explained = (input: { explanation?: string }) => (input?.explanation ? { explanation: String(input.explanation).slice(0, 2000) } : {})

export async function previewSetRecyclingTerms(deps: ActionDeps, input: WithVehicle<RecyclingTermsInput>): Promise<PreviewResult> {
  const group = await vehicleOf(deps, input)
  const parsed = parseRecyclingTerms(input ?? {})
  if ('error' in parsed) throw new Error(parsed.error)
  const before = await loadRecyclingTerms(deps.admin, deps.fundId, group)
  const after = parsed.value
  const changes = (['capRate', 'capBasis', 'until', 'uses', 'defaultTreatment'] as const)
    .filter(k => (before[k] ?? null) !== (after[k] ?? null))
    .map(k => ({ field: k, before: before[k] ?? null, after: after[k] ?? null }))
  return {
    summary: `Set ${group}'s recycling terms: ${describeRecyclingTerms(after)}`,
    details: {
      vehicle: group,
      before: { ...before, description: describeRecyclingTerms(before) },
      after: { ...after, description: describeRecyclingTerms(after) },
      changes,
      effect: 'Recycled amounts recorded from now on are checked against these terms. Amounts already recorded stay as they are.',
      ...explained(input),
    },
  }
}

export async function executeSetRecyclingTerms(deps: ActionDeps, input: WithVehicle<RecyclingTermsInput>): Promise<Record<string, unknown>> {
  const group = await vehicleOf(deps, input)
  const saved = await saveRecyclingTerms(deps.admin, deps.fundId, group, input ?? {})
  if ('error' in saved) throw new Error(saved.error)
  return { vehicle: group, terms: saved.terms, description: describeRecyclingTerms(saved.terms) }
}

export async function previewRecordRecycling(deps: ActionDeps, input: WithVehicle<RecordRecyclingInput>): Promise<PreviewResult> {
  const group = await vehicleOf(deps, input)
  const checked = await checkRecycling(deps.admin, deps.fundId, group, input ?? {})
  if ('error' in checked) throw new Error(checked.error)
  const c = checked.value
  const names = c.perLp.length ? await loadEntityNames(deps.admin, deps.fundId, group) : new Map<string, string>()
  return {
    summary: `Recycle ${money(c.amount)} of ${group}'s proceeds received ${c.date}, ${TREATMENT_LABEL[c.treatment]}`,
    details: {
      vehicle: group,
      date: c.date,
      amount: c.amount,
      treatment: c.treatment,
      treatmentLabel: TREATMENT_LABEL[c.treatment],
      ...(c.description ? { description: c.description } : {}),
      ...(c.companyId ? { companyId: c.companyId } : {}),
      cap: c.status.cap,
      usedBefore: c.status.used,
      leftAfter: Math.max(0, Math.round((c.status.headroom - c.amount) * 100) / 100),
      ...(c.perLp.length ? { partners: c.perLp.map(l => ({ ...l, name: names.get(l.lpEntityId) ?? l.lpEntityId })) } : {}),
      effect: c.treatment === 'deemed'
        ? 'Posts one entry dated the same day, with no cash and no notices: each partner shows a distribution and a contribution of their share, so called capital and distributions both rise by it and their uncalled commitment is unchanged. It appears on the next statement and K-1.'
        : 'Posts nothing. The cash stays in the fund, the amount counts against the cap, and later calls are smaller by it.',
      ...explained(input),
    },
  }
}

export async function executeRecordRecycling(deps: ActionDeps, input: WithVehicle<RecordRecyclingInput>): Promise<Record<string, unknown>> {
  const group = await vehicleOf(deps, input)
  const done = await recordRecycling(deps.admin, deps.fundId, group, deps.userId, input ?? {})
  if ('error' in done) throw new Error(done.error)
  return { vehicle: group, id: done.id, entryId: done.entryId, amount: done.checked.amount, treatment: done.checked.treatment }
}

export async function previewRemoveRecycling(deps: ActionDeps, input: WithVehicle<{ id?: string }>): Promise<PreviewResult> {
  const group = await vehicleOf(deps, input)
  const status = await recyclingStatus(deps.admin, deps.fundId, group)
  const row = status.rows.find(r => r.id === input?.id)
  if (!row) throw new Error(`No recycled amount with that id on ${group}.`)
  if (row.treatment === 'deemed' && row.live) {
    throw new Error('This amount was booked as distributed and recontributed. Void its entry first (void_entry, with a reason), then remove it.')
  }
  return {
    summary: `Remove ${money(row.amount)} recycled on ${row.recycledOn} from ${group}'s register`,
    details: { vehicle: group, row, effect: 'The amount no longer counts against the cap. Nothing is posted.', ...explained(input) },
  }
}

export async function executeRemoveRecycling(deps: ActionDeps, input: WithVehicle<{ id?: string }>): Promise<Record<string, unknown>> {
  const group = await vehicleOf(deps, input)
  const done = await removeRecycling(deps.admin, deps.fundId, group, input?.id)
  if ('error' in done) throw new Error(done.error)
  return { vehicle: group, removed: done.row }
}
