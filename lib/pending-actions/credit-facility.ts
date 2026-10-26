// Credit facilities, staged for a person to approve: what set_credit_facility,
// record_facility_event and remove_facility_event stage (their manifests' `stagesAs`). Applied
// through lib/accounting/credit-facility.ts, the one write path, so an approved proposal is checked
// exactly as it would be at the time.

import type { ActionDeps, PreviewResult } from './types'
import { resolveVehicle } from '@/lib/accounting/vehicle-resolver'
import {
  checkFacilityEvent,
  DRAW_PURPOSE_LABEL,
  EVENT_TYPE_LABEL,
  FACILITY_KIND_LABEL,
  loadFacilityRegister,
  parseFacility,
  recordFacilityEvent,
  removeFacilityEvent,
  saveFacility,
  type FacilityEventInput,
  type FacilityInput,
} from '@/lib/accounting/credit-facility'

type WithVehicle<T> = T & { vehicle?: string; explanation?: string }

const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const vehicleOf = (deps: ActionDeps, input: { vehicle?: string }) => resolveVehicle(deps.admin, deps.fundId, input?.vehicle, { access: deps.access })
const explained = (input: { explanation?: string }) => (input?.explanation ? { explanation: String(input.explanation).slice(0, 2000) } : {})

export async function previewSetCreditFacility(deps: ActionDeps, input: WithVehicle<FacilityInput>): Promise<PreviewResult> {
  const group = await vehicleOf(deps, input)
  const parsed = parseFacility(input ?? {})
  if ('error' in parsed) throw new Error(parsed.error)
  const after = parsed.value
  const register = await loadFacilityRegister(deps.admin, deps.fundId, group)
  const before = typeof input?.id === 'string' && input.id ? register.facilities.find(f => f.id === input.id) : undefined
  if (input?.id && !before) throw new Error(`No facility with that id on ${group}.`)
  return {
    summary: before
      ? `Change ${group}'s ${before.name}`
      : `Add ${FACILITY_KIND_LABEL[after.kind].toLowerCase()} "${after.name}" to ${group}${after.commitmentAmount ? ` (${money(after.commitmentAmount)})` : ''}`,
    details: {
      vehicle: group,
      ...(before ? { before } : {}),
      after,
      effect: 'Nothing is posted. Draws, repayments, interest and fees are recorded against the facility separately.',
      ...explained(input),
    },
  }
}

export async function executeSetCreditFacility(deps: ActionDeps, input: WithVehicle<FacilityInput>): Promise<Record<string, unknown>> {
  const group = await vehicleOf(deps, input)
  const saved = await saveFacility(deps.admin, deps.fundId, group, deps.userId, input ?? {})
  if ('error' in saved) throw new Error(saved.error)
  return { vehicle: group, facility: saved.facility }
}

export async function previewRecordFacilityEvent(deps: ActionDeps, input: WithVehicle<FacilityEventInput>): Promise<PreviewResult> {
  const group = await vehicleOf(deps, input)
  const checked = await checkFacilityEvent(deps.admin, deps.fundId, group, input ?? {})
  if ('error' in checked) throw new Error(checked.error)
  const c = checked.value
  const what = c.type === 'draw' ? `${EVENT_TYPE_LABEL.draw} for ${DRAW_PURPOSE_LABEL[c.purpose ?? 'investment'].toLowerCase()}` : EVENT_TYPE_LABEL[c.type]
  const posting = c.type === 'draw' ? 'Dr cash / Cr loan payable'
    : c.type === 'repayment' ? 'Dr loan payable / Cr cash'
    : 'Dr interest expense / Cr cash, allocated to the partners like any expense'
  return {
    summary: `${what} of ${money(c.amount)} on ${group}'s ${c.facility.name}, ${c.date}`,
    details: {
      vehicle: group,
      facility: c.facility.name,
      type: c.type,
      date: c.date,
      amount: c.amount,
      ...(c.purpose ? { purpose: c.purpose } : {}),
      ...(c.callId ? { callId: c.callId } : {}),
      ...(c.memo ? { memo: c.memo } : {}),
      outstandingBefore: c.facility.balance.outstanding,
      outstandingAfter: c.outstandingAfter,
      effect: c.link
        ? `Links entry ${c.link.entryId}, already on the books, to the facility. Nothing new is posted.`
        : `Posts one entry dated ${c.date}: ${posting}.`,
      ...explained(input),
    },
  }
}

export async function executeRecordFacilityEvent(deps: ActionDeps, input: WithVehicle<FacilityEventInput>): Promise<Record<string, unknown>> {
  const group = await vehicleOf(deps, input)
  const done = await recordFacilityEvent(deps.admin, deps.fundId, group, deps.userId, input ?? {})
  if ('error' in done) throw new Error(done.error)
  return { vehicle: group, id: done.id, entryId: done.entryId, linked: !!done.checked.link, outstandingAfter: done.checked.outstandingAfter }
}

export async function previewRemoveFacilityEvent(deps: ActionDeps, input: WithVehicle<{ id?: string }>): Promise<PreviewResult> {
  const group = await vehicleOf(deps, input)
  const register = await loadFacilityRegister(deps.admin, deps.fundId, group)
  const row = register.events.find(e => e.id === input?.id)
  if (!row) throw new Error(`No facility row with that id on ${group}.`)
  if (row.origin === 'posted' && row.live) throw new Error('This row posted its own entry. Void the entry first (void_entry, with a reason), then remove the row.')
  return {
    summary: `Remove a ${EVENT_TYPE_LABEL[row.type].toLowerCase()} of ${money(row.amount)} on ${row.date} from ${group}'s facility register`,
    details: {
      vehicle: group,
      row,
      effect: row.origin === 'linked' ? 'The row comes off the register; its entry stays on the books.' : 'The row comes off the register. Its entry is already void.',
      ...explained(input),
    },
  }
}

export async function executeRemoveFacilityEvent(deps: ActionDeps, input: WithVehicle<{ id?: string }>): Promise<Record<string, unknown>> {
  const group = await vehicleOf(deps, input)
  const done = await removeFacilityEvent(deps.admin, deps.fundId, group, input?.id)
  if ('error' in done) throw new Error(done.error)
  return { vehicle: group, removed: done.event }
}
