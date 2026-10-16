// The CLI's vehicle-terms file (terms.json): carry terms, partners, and an optional waterfall
// state for running a distribution without a ledger. Schema documented in the README.

import { NO_CARRY, resolveCarryRecipients, type CarryKind, type VehicleCarryTerms } from './carry.ts'
import type { WaterfallState } from './waterfall.ts'
import type { PartnerMapping } from './books.ts'

export interface TermsPartner extends PartnerMapping {
  name?: string
  commitment?: number
}

export interface VehicleTerms {
  vehicle?: string
  carry: VehicleCarryTerms
  partners: TermsPartner[]
  capitalAccountPattern?: RegExp
  /** Cumulative waterfall state, for `waterfall` without a ledger. */
  state?: WaterfallState
}

const KINDS: CarryKind[] = ['none', 'straight', 'american', 'european']

function num(v: unknown, field: string, fallback: number): number {
  if (v === undefined || v === null) return fallback
  const n = Number(v)
  if (!Number.isFinite(n)) throw new Error(`terms: ${field} must be a number`)
  return n
}

/** Validate and normalize a parsed terms.json. Throws with the offending field on bad input. */
export function parseVehicleTerms(raw: unknown): VehicleTerms {
  if (!raw || typeof raw !== 'object') throw new Error('terms: expected a JSON object')
  const t = raw as Record<string, any>

  const c = (t.carry ?? {}) as Record<string, any>
  const kind = c.kind ?? 'none'
  if (!KINDS.includes(kind)) throw new Error(`terms: carry.kind must be one of ${KINDS.join(', ')}`)
  const carryRate = num(c.carryRate ?? c.carry_rate, 'carry.carryRate', 0)
  const prefRate = num(c.prefRate ?? c.pref_rate ?? c.hurdleRate, 'carry.prefRate', 0)
  const catchupRate = num(c.catchupRate ?? c.catchup_rate ?? c.catchUpRate, 'carry.catchupRate', 1)
  for (const [field, v] of [['carryRate', carryRate], ['prefRate', prefRate], ['catchupRate', catchupRate]] as const) {
    if (v < 0 || v > 1) throw new Error(`terms: carry.${field} is a fraction (0.2 for 20%), got ${v}`)
  }
  const prefCompounds = (c.prefCompounds ?? c.pref_compounds) !== false
  const gpEntityId = typeof (c.gpEntityId ?? c.gp_entity_id) === 'string' ? (c.gpEntityId ?? c.gp_entity_id) : null
  const recipientsRaw = Array.isArray(c.recipients)
    ? c.recipients.map((r: any) => ({ lpEntityId: r?.partner ?? r?.lpEntityId, pct: r?.pct }))
    : c.carry_recipients
  const recipients = resolveCarryRecipients(recipientsRaw, gpEntityId)
  if (recipients.length > 0) {
    const total = recipients.reduce((s, r) => s + r.pct, 0)
    if (Math.abs(total - 100) > 1e-9) throw new Error(`terms: carry.recipients pct must sum to 100, got ${total}`)
  }
  const carry: VehicleCarryTerms = kind === 'none'
    ? { ...NO_CARRY, recipients }
    : { kind, carryRate, prefRate, catchupRate, prefCompounds, gpEntityId, recipients }

  const partners: TermsPartner[] = []
  for (const [i, p] of (Array.isArray(t.partners) ? t.partners : []).entries()) {
    if (!p || typeof p.id !== 'string' || !p.id) throw new Error(`terms: partners[${i}].id is required`)
    partners.push({
      id: p.id,
      name: typeof p.name === 'string' ? p.name : undefined,
      account: typeof p.account === 'string' ? p.account : undefined,
      commitment: p.commitment === undefined ? undefined : num(p.commitment, `partners[${i}].commitment`, 0),
    })
  }

  let capitalAccountPattern: RegExp | undefined
  if (typeof t.capitalAccountPattern === 'string') {
    try { capitalAccountPattern = new RegExp(t.capitalAccountPattern) } catch { throw new Error('terms: capitalAccountPattern is not a valid regular expression') }
  }

  let state: WaterfallState | undefined
  if (t.state && typeof t.state === 'object') {
    const s = t.state as Record<string, unknown>
    state = {
      contributedCapital: num(s.contributedCapital, 'state.contributedCapital', 0),
      returnedCapital: num(s.returnedCapital, 'state.returnedCapital', 0),
      preferredPaid: num(s.preferredPaid, 'state.preferredPaid', 0),
      preferredTarget: num(s.preferredTarget, 'state.preferredTarget', 0),
      gpCarryPaid: num(s.gpCarryPaid, 'state.gpCarryPaid', 0),
    }
  }

  return {
    vehicle: typeof t.vehicle === 'string' ? t.vehicle : undefined,
    carry,
    partners,
    capitalAccountPattern,
    state,
  }
}
