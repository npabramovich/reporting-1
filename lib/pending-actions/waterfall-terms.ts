// Setting a vehicle's carry (waterfall) terms, staged for a person to approve: what the
// `set_waterfall_terms` tool stages (its manifest's `stagesAs`), usually with terms proposed from the
// LPA by `extract_lpa_terms`. Applied through the same write the settings page makes
// (lib/accounting/waterfall-terms.ts), so an approved proposal is checked exactly as a typed one.
//
// The preview is what the approver decides on: today's terms beside the new ones, who receives the
// carry, and each term's clause from the LPA — re-checked here against the document, whatever the
// stager claimed about it.

import type { ActionDeps, PreviewResult } from './types'
import { resolveVehicle } from '@/lib/accounting/vehicle-resolver'
import { vehicleIdByName } from '@/lib/accounting/vehicle-id'
import { loadCarryTerms, type VehicleCarryTerms } from '@/lib/accounting/carry'
import { parseWaterfallTermsInput, recipientIdsOf, saveWaterfallTerms, type ValidWaterfallTerms, type WaterfallTermsInput } from '@/lib/accounting/waterfall-terms'
import { verifyQuote } from '@/lib/accounting/lpa-terms'
import { getDocument } from '@/lib/entity-documents'

export interface SetWaterfallTermsInput extends WaterfallTermsInput {
  vehicle?: string
  /** The entity document the terms were read from; each source quote is re-checked against it. */
  documentId?: string
  sources?: { field?: string; quote?: string; section?: string | null; page?: number | null; confidence?: string }[]
  explanation?: string
}

function pct(n: number): string {
  return `${+(n * 100).toFixed(4)}%`
}

/** The terms in words, the way the summary line and the approver read them. */
export function describeTerms(t: Pick<ValidWaterfallTerms, 'kind' | 'carryRate' | 'prefRate' | 'catchupRate' | 'prefCompounds'>): string {
  if (t.kind === 'none' || t.carryRate <= 0) return 'no carry'
  const label = { straight: 'straight', american: 'American (deal-by-deal)', european: 'European (whole-fund)', none: 'no' }[t.kind]
  if (t.kind === 'straight') return `${label} ${pct(t.carryRate)} carry, no hurdle`
  const hurdle = t.prefRate > 0 ? `${pct(t.prefRate)} ${t.prefCompounds ? 'compounding' : 'simple'} preferred return` : 'no preferred return'
  return `${label} ${pct(t.carryRate)} carry, ${hurdle}, ${pct(t.catchupRate)} GP catch-up`
}

function currentAsValid(c: VehicleCarryTerms): ValidWaterfallTerms {
  return { kind: c.kind, carryRate: c.carryRate, prefRate: c.prefRate, catchupRate: c.catchupRate, prefCompounds: c.prefCompounds, gpEntityId: c.gpEntityId, recipients: c.recipients }
}

async function resolve(deps: ActionDeps, input: SetWaterfallTermsInput) {
  const group = await resolveVehicle(deps.admin, deps.fundId, input?.vehicle, { access: deps.access })
  const parsed = parseWaterfallTermsInput(input ?? {})
  if ('error' in parsed) throw new Error(parsed.error)
  return { group, terms: parsed.value }
}

export async function previewSetWaterfallTerms(deps: ActionDeps, input: SetWaterfallTermsInput): Promise<PreviewResult> {
  const { group, terms } = await resolve(deps, input)
  const before = currentAsValid(await loadCarryTerms(deps.admin, deps.fundId, group))

  const ids = Array.from(new Set([...recipientIdsOf(terms), ...recipientIdsOf(before)]))
  const { data: ents } = ids.length
    ? await deps.admin.from('lp_entities' as any).select('id, entity_name').eq('fund_id', deps.fundId).in('id', ids)
    : { data: [] as any[] }
  const names = new Map(((ents as any[]) ?? []).map(e => [e.id as string, e.entity_name as string]))
  const flags: { severity: 'blocker' | 'warning'; code: string; message: string }[] = []
  const foreign = recipientIdsOf(terms).filter(id => !names.has(id))
  if (foreign.length > 0) flags.push({ severity: 'blocker', code: 'recipient_not_in_fund', message: 'A carry recipient is not in this fund.' })

  const recipientsOf = (t: ValidWaterfallTerms) =>
    (t.recipients.length ? t.recipients : t.gpEntityId ? [{ lpEntityId: t.gpEntityId, pct: 100 }] : [])
      .map(r => ({ lpEntityId: r.lpEntityId, name: names.get(r.lpEntityId) ?? r.lpEntityId, pct: r.pct }))

  const changes = (['kind', 'carryRate', 'prefRate', 'catchupRate', 'prefCompounds'] as const)
    .filter(k => before[k] !== terms[k])
    .map(k => ({ field: k, before: before[k], after: terms[k] }))

  // Each quote is checked against the document here, on the server: the approver should not have
  // to take the stager's word that the LPA says what it quotes.
  let document: { id: string; title: string } | null = null
  let text: string | null = null
  if (typeof input?.documentId === 'string' && input.documentId) {
    const vehicleId = await vehicleIdByName(deps.admin, deps.fundId, group)
    const doc = vehicleId ? await getDocument(deps.admin, deps.fundId, input.documentId, [vehicleId]) : null
    if (!doc) flags.push({ severity: 'warning', code: 'document_not_found', message: `The source document is not one of ${group}'s documents; its quotes could not be checked.` })
    else { document = { id: doc.id, title: doc.title }; text = doc.extracted_text }
  }
  const sources = (Array.isArray(input?.sources) ? input.sources : []).slice(0, 20).map(s => {
    const quote = typeof s?.quote === 'string' ? s.quote.slice(0, 800) : ''
    return {
      field: typeof s?.field === 'string' ? s.field : null,
      quote,
      section: typeof s?.section === 'string' ? s.section : null,
      page: Number.isInteger(s?.page) ? s.page : null,
      confidence: typeof s?.confidence === 'string' ? s.confidence : null,
      quoteVerified: text && quote ? verifyQuote(quote, text) : null,
    }
  })
  const unverified = sources.filter(s => s.quoteVerified === false)
  if (unverified.length > 0) {
    flags.push({ severity: 'warning', code: 'quote_not_found', message: `${unverified.map(s => s.field ?? 'a term').join(', ')}: the quoted clause was not found in ${document?.title ?? 'the document'}. Read it before approving.` })
  }
  const lowConfidence = sources.filter(s => s.confidence === 'low')
  if (lowConfidence.length > 0) flags.push({ severity: 'warning', code: 'low_confidence', message: `Read at low confidence: ${lowConfidence.map(s => s.field).join(', ')}.` })
  if (terms.kind === 'straight' && terms.prefRate > 0) {
    flags.push({ severity: 'warning', code: 'straight_ignores_hurdle', message: 'Straight carry ignores the preferred return and catch-up; the rate is stored but not used.' })
  }
  if (terms.kind !== 'none' && terms.carryRate > 0 && terms.kind !== 'straight' && terms.catchupRate === 0) {
    flags.push({ severity: 'warning', code: 'no_catch_up', message: 'A 0% catch-up: the GP never catches up, so its share stays below the carry rate of total profit.' })
  }

  return {
    summary: `Set ${group}'s carry terms: ${describeTerms(terms)}`,
    details: {
      vehicle: group,
      before: { ...before, recipients: recipientsOf(before), description: describeTerms(before) },
      after: { ...terms, recipients: recipientsOf(terms), description: describeTerms(terms) },
      changes,
      ...(document ? { document } : {}),
      sources,
      flags,
      effect: 'The next period close accrues carry on these terms (the accrual is recomputed from scratch, so earlier ' +
        'periods are not restated), and distributions declared afterwards are split through the waterfall on them.',
      ...(input?.explanation ? { explanation: String(input.explanation).slice(0, 2000) } : {}),
    },
  }
}

export async function executeSetWaterfallTerms(deps: ActionDeps, input: SetWaterfallTermsInput): Promise<Record<string, unknown>> {
  const { group } = await resolve(deps, input)
  const saved = await saveWaterfallTerms(deps.admin, deps.fundId, group, input)
  if ('error' in saved) throw new Error(saved.error)
  return { vehicle: group, terms: saved.terms, description: describeTerms(saved.terms) }
}
