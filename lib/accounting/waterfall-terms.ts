// Setting a vehicle's carry (waterfall) terms: ONE write path, used by the web route
// (PUT /api/accounting/waterfall-terms) and by the approved `set_waterfall_terms` pending action, so
// a term proposed from an LPA is checked and stored exactly as one typed into the settings page.
//
// The spec for what these terms mean is docs/spec/waterfall-terms.md.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { CarryKind, CarryRecipient } from './carry'
import { vehicleIdByName } from './vehicle-id'

export const CARRY_KINDS: CarryKind[] = ['none', 'straight', 'american', 'european']

/** The terms as a caller supplies them (the route's PUT body, the pending action's input). */
export interface WaterfallTermsInput {
  kind?: unknown
  carryRate?: unknown
  prefRate?: unknown
  catchupRate?: unknown
  prefCompounds?: unknown
  gpEntityId?: unknown
  carryRecipients?: unknown
}

/** Validated terms, ready to store. Rates are fractions (0.2 = 20%). */
export interface ValidWaterfallTerms {
  kind: CarryKind
  carryRate: number
  prefRate: number
  catchupRate: number
  prefCompounds: boolean
  gpEntityId: string | null
  recipients: CarryRecipient[]
}

/** As the route always read them: `Number(v)`, or the fallback when that is not finite. */
function num(v: unknown, fallback = 0): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

/**
 * Check the terms without touching the database: the kind, each rate's range (the table's CHECKs),
 * a recipient whenever carry is on, and recipient percentages that total 100. Messages are the
 * route's, word for word, because a person reads them in the settings page.
 */
export function parseWaterfallTermsInput(body: WaterfallTermsInput): { ok: true; value: ValidWaterfallTerms } | { error: string } {
  const kind = body?.kind
  if (typeof kind !== 'string' || !(CARRY_KINDS as string[]).includes(kind)) {
    return { error: 'kind must be none, straight, american, or european.' }
  }
  const carryRate = num(body?.carryRate)
  const prefRate = num(body?.prefRate)
  const catchupRate = num(body?.catchupRate, 1)

  if (carryRate < 0 || carryRate >= 1) return { error: 'Carry rate must be a fraction between 0 and 1 (0.2 = 20%).' }
  if (prefRate < 0 || prefRate >= 1) return { error: 'Preferred return must be a fraction between 0 and 1 (0.08 = 8%).' }
  if (catchupRate < 0 || catchupRate > 1) return { error: 'Catch-up rate must be between 0 and 1.' }

  // Carry has to accrue TO somebody. A vehicle may have ONE recipient (legacy gpEntityId) or a
  // split across several (carryRecipients: [{lpEntityId, pct}] summing to 100). Without any the
  // close would compute an accrual it cannot post — refuse here rather than fail mid-close.
  const gpEntityId = typeof body?.gpEntityId === 'string' && body.gpEntityId ? body.gpEntityId : null
  const recipients: CarryRecipient[] = Array.isArray(body?.carryRecipients)
    ? (body.carryRecipients as any[])
        .filter(r => r && typeof r.lpEntityId === 'string')
        .map(r => ({ lpEntityId: String(r.lpEntityId), pct: Number(r.pct) }))
        .filter(r => Number.isFinite(r.pct) && r.pct > 0)
    : []
  const carryOn = kind !== 'none' && carryRate > 0
  if (carryOn && recipients.length === 0 && !gpEntityId) return { error: 'Choose who receives the carry.' }
  if (recipients.length > 0) {
    const sum = recipients.reduce((s, r) => s + r.pct, 0)
    if (Math.abs(sum - 100) > 0.01) return { error: `Carry recipient percentages must total 100 (they total ${sum}).` }
  }

  return {
    ok: true,
    value: {
      kind: kind as CarryKind,
      carryRate,
      prefRate,
      catchupRate,
      prefCompounds: body?.prefCompounds !== false,
      gpEntityId,
      recipients,
    },
  }
}

/** Every recipient id the terms name (the list and the legacy single GP). */
export function recipientIdsOf(terms: Pick<ValidWaterfallTerms, 'recipients' | 'gpEntityId'>): string[] {
  return Array.from(new Set([...terms.recipients.map(r => r.lpEntityId), ...(terms.gpEntityId ? [terms.gpEntityId] : [])]))
}

/**
 * Validate and store a vehicle's terms. `status` is the HTTP status the route answers with; a
 * pending action throws the message.
 */
export async function saveWaterfallTerms(
  admin: SupabaseClient,
  fundId: string,
  group: string,
  body: WaterfallTermsInput,
): Promise<{ ok: true; terms: ValidWaterfallTerms } | { error: string; status: number; dbError?: { message: string } }> {
  const vehicleId = await vehicleIdByName(admin, fundId, group)
  if (!vehicleId) return { error: `Unknown vehicle "${group}".`, status: 400 }

  const parsed = parseWaterfallTermsInput(body)
  if ('error' in parsed) return { error: parsed.error, status: 400 }
  const terms = parsed.value

  // Every named recipient (and the legacy single GP) must be a partner in this fund.
  const idsToCheck = recipientIdsOf(terms)
  if (idsToCheck.length > 0) {
    const { data: ents } = await admin.from('lp_entities' as any).select('id').eq('fund_id', fundId).in('id', idsToCheck)
    const known = new Set(((ents as any[]) ?? []).map(e => e.id))
    if (idsToCheck.some(id => !known.has(id))) return { error: 'A carry recipient is not in this fund.', status: 400 }
  }

  // Keep gp_entity_id meaningful as the single-recipient fallback: the sole recipient when there
  // is exactly one, otherwise the explicit legacy value (or null).
  const { recipients } = terms
  const singleGp = recipients.length === 1 ? recipients[0].lpEntityId : recipients.length === 0 ? terms.gpEntityId : null

  const { error } = await admin
    .from('vehicle_waterfall_terms' as any)
    .upsert(
      {
        fund_id: fundId,
        vehicle_id: vehicleId,
        kind: terms.kind,
        carry_rate: terms.carryRate,
        pref_rate: terms.prefRate,
        catchup_rate: terms.catchupRate,
        pref_compounds: terms.prefCompounds,
        gp_entity_id: singleGp,
        carry_recipients: recipients.length > 0 ? recipients : null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'fund_id,vehicle_id' }
    )
  if (error) return { error: 'The terms could not be saved.', status: 500, dbError: error }
  return { ok: true, terms }
}
