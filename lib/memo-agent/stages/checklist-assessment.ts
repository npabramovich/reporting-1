import { createAdminClient } from '@/lib/supabase/admin'
import { logAIUsage } from '@/lib/ai/usage'
import { buildSystemPrompt } from '@/lib/memo-agent/prompts/system'
import { buildChecklistAssessmentContent } from '@/lib/memo-agent/prompts/checklist-assessment'
import { getStageProvider } from '@/lib/memo-agent/stage-provider'
import { extractJsonObject, recoverArrayItems } from '@/lib/memo-agent/parse-ai-json'
import type { IngestionOutput } from './ingest'

type Admin = ReturnType<typeof createAdminClient>

// Items are assessed in batches (see below), so each call's output stays well
// under this cap regardless of total checklist length. Kept generous as a
// backstop; per-batch salvage handles the rare overflow.
const ASSESSMENT_MAX_TOKENS = 16384

// Checklist items assessed per LLM call. The data-room context is shared across
// batches (resent each call), but only this many items are scored per call —
// bounding output size so the token cap stops being load-bearing on long
// checklists. ~25 terse item assessments is a few thousand output tokens.
const ASSESSMENT_BATCH_SIZE = 25

export interface ChecklistAssessmentResult {
  items_assessed: number
  items_found: number
  items_partial: number
  items_missing: number
  warnings: string[]
}

interface AssessmentEntry {
  id: string
  status: 'found' | 'partial' | 'missing' | 'unknown'
  evidence: Array<{ document_id: string; summary: string }>
  notes: string
}

/**
 * Walk the deal's diligence checklist against the latest data-room ingest
 * output and mark each item found / partial / missing with evidence.
 *
 * Runs after `ingest_synthesis` — uses the per-doc summaries + claims already
 * on the draft (no re-parsing of files).
 */
export async function runChecklistAssessment(params: {
  admin: Admin
  fundId: string
  dealId: string
  draftId?: string
  progressCb?: (msg: string) => Promise<void>
}): Promise<ChecklistAssessmentResult> {
  const { admin, fundId, dealId, progressCb } = params
  const note = async (msg: string) => { if (progressCb) await progressCb(msg) }
  const warnings: string[] = []

  await note('Loading checklist…')
  const { data: itemRows, error: itemErr } = await (admin as any)
    .from('diligence_checklist_items')
    .select('id, parent_id, kind, label')
    .eq('deal_id', dealId)
    .eq('fund_id', fundId)
    .order('order_index', { ascending: true })
  if (itemErr) throw new Error(`Failed to load checklist: ${itemErr.message}`)

  const allRows = (itemRows ?? []) as Array<{ id: string; parent_id: string | null; kind: 'section' | 'item'; label: string }>
  const sectionLabelById = new Map<string, string>()
  for (const r of allRows) if (r.kind === 'section') sectionLabelById.set(r.id, r.label)

  const items = allRows.filter(r => r.kind === 'item').map(r => ({
    id: r.id,
    section: r.parent_id ? (sectionLabelById.get(r.parent_id) ?? null) : null,
    label: r.label,
  }))

  if (items.length === 0) {
    return { items_assessed: 0, items_found: 0, items_partial: 0, items_missing: 0, warnings: ['No checklist items to assess.'] }
  }

  await note('Loading data-room ingest output…')
  const { data: draftRow } = await (admin as any)
    .from('diligence_memo_drafts')
    .select('id, ingestion_output')
    .eq('deal_id', dealId)
    .eq('fund_id', fundId)
    .eq('is_draft', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const ingestion = ((draftRow as any)?.ingestion_output ?? {}) as Partial<IngestionOutput>
  const docs = Array.isArray(ingestion.documents) ? ingestion.documents : []

  if (docs.length === 0) {
    warnings.push('No ingested data-room documents yet; items will be left as unknown.')
    return { items_assessed: 0, items_found: 0, items_partial: 0, items_missing: 0, warnings }
  }

  await note('Loading deal context…')
  const { data: dealRow } = await admin
    .from('diligence_deals')
    .select('name, stage_at_consideration')
    .eq('id', dealId)
    .eq('fund_id', fundId)
    .maybeSingle()
  const dealName = (dealRow as { name: string } | null)?.name ?? 'this deal'
  const dealStage = (dealRow as { stage_at_consideration: string | null } | null)?.stage_at_consideration ?? null

  // Resolve human file names for the evidence prompt — the ingest output only
  // carries document_ids.
  const docIds = docs.map(d => d.document_id).filter(Boolean)
  const { data: docNameRows } = await admin
    .from('diligence_documents')
    .select('id, file_name')
    .in('id', docIds.length > 0 ? docIds : ['00000000-0000-0000-0000-000000000000'])
    .eq('deal_id', dealId)
    .eq('fund_id', fundId)
  const nameById = new Map<string, string>()
  for (const r of (docNameRows ?? []) as Array<{ id: string; file_name: string }>) {
    nameById.set(r.id, r.file_name)
  }

  await note('Building system prompt…')
  const { prompt: system } = await buildSystemPrompt({ admin, fundId, stage: 'ingest' })

  const { provider, model, providerType } = await getStageProvider(admin, fundId, 'ingest')

  // Shared data-room context — resent with every batch.
  const perDoc = docs.map(d => ({
    document_id: d.document_id,
    file_name: nameById.get(d.document_id) ?? d.document_id,
    detected_type: d.detected_type,
    summary: d.summary,
    claims: d.claims.map(c => ({ field: c.field, value: c.value })),
  }))

  const batches: (typeof items)[] = []
  for (let i = 0; i < items.length; i += ASSESSMENT_BATCH_SIZE) {
    batches.push(items.slice(i, i + ASSESSMENT_BATCH_SIZE))
  }

  // The LLM calls ARE the assessment. A single batch failing transiently
  // shouldn't nuke the whole run, so per-batch failures are collected as
  // warnings and we keep going — but if *every* batch yields nothing usable
  // the job fails (below) with the collected reasons, so the worker marks it
  // failed rather than success-with-nothing.
  const assessments: AssessmentEntry[] = []
  const batchErrors: string[] = []
  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b]
    const from = b * ASSESSMENT_BATCH_SIZE + 1
    const to = from + batch.length - 1
    await note(
      batches.length === 1
        ? `Assessing ${items.length} checklist items against ${docs.length} document${docs.length === 1 ? '' : 's'}…`
        : `Assessing checklist items ${from}–${to} of ${items.length}…`,
    )

    const content = buildChecklistAssessmentContent({ dealName, stage: dealStage, checklist: batch, perDoc })

    let rawText = ''
    let truncated = false
    try {
      const { text, usage, truncated: cut } = await provider.createMessage({
        model,
        maxTokens: ASSESSMENT_MAX_TOKENS,
        system,
        content,
      })
      logAIUsage(admin, {
        fundId,
        provider: providerType,
        model,
        feature: 'memo_agent_checklist_assessment',
        usage,
      })
      rawText = text
      truncated = !!cut
    } catch (err) {
      batchErrors.push(`batch ${b + 1}/${batches.length}: ${err instanceof Error ? err.message : String(err)}`)
      continue
    }

    let batchAssessments: AssessmentEntry[]
    try {
      batchAssessments = parseAssessmentResponse(rawText)
    } catch (err) {
      // Whole-response parse failed — almost always a mid-array truncation.
      // Salvage every item the model finished before the cut.
      batchAssessments = recoverArrayItems(rawText, 'items')
        .map(toAssessmentEntry)
        .filter((e): e is AssessmentEntry => e !== null)
      if (batchAssessments.length === 0) {
        batchErrors.push(
          truncated
            ? `batch ${b + 1}/${batches.length}: truncated at the ${ASSESSMENT_MAX_TOKENS}-token output limit before any item could be recovered`
            : `batch ${b + 1}/${batches.length}: unparseable response (${err instanceof Error ? err.message : String(err)})`,
        )
      } else {
        warnings.push(
          truncated
            ? `Batch ${b + 1} hit the ${ASSESSMENT_MAX_TOKENS}-token output limit; recovered ${batchAssessments.length} item(s) completed before the cut and left the rest unchanged.`
            : `Batch ${b + 1} response was partially malformed; recovered ${batchAssessments.length} item assessment(s) and skipped the rest.`,
        )
      }
    }
    assessments.push(...batchAssessments)
  }

  if (assessments.length === 0) {
    throw new Error(
      `Checklist assessment produced no usable item entries${batchErrors.length ? ` (${batchErrors.join('; ')})` : ''}.`,
    )
  }
  if (batchErrors.length > 0) {
    warnings.push(`${batchErrors.length} of ${batches.length} batch(es) failed: ${batchErrors.join('; ')}.`)
  }

  await note('Writing checklist assessments…')
  const itemIdSet = new Set(items.map(i => i.id))
  let found = 0, partial = 0, missing = 0, assessed = 0
  for (const entry of assessments) {
    if (!itemIdSet.has(entry.id)) continue
    assessed += 1
    if (entry.status === 'found') found += 1
    else if (entry.status === 'partial') partial += 1
    else if (entry.status === 'missing') missing += 1

    const evidence = entry.evidence
      .filter(e => typeof e.document_id === 'string' && itemIdSet.size > 0)
      .slice(0, 3)
    await (admin as any)
      .from('diligence_checklist_items')
      .update({
        status: entry.status,
        evidence: evidence as any,
        agent_notes: entry.notes || null,
        updated_at: new Date().toISOString(),
      } as any)
      .eq('id', entry.id)
      .eq('deal_id', dealId)
      .eq('fund_id', fundId)
  }

  return { items_assessed: assessed, items_found: found, items_partial: partial, items_missing: missing, warnings }
}

function parseAssessmentResponse(raw: string): AssessmentEntry[] {
  const parsed = extractJsonObject(raw)
  if (!parsed || typeof parsed !== 'object') return []
  const obj = parsed as { items?: unknown }
  const items = Array.isArray(obj.items) ? obj.items : []
  return items.map(toAssessmentEntry).filter((e): e is AssessmentEntry => e !== null)
}

/** Normalize one raw item object into an AssessmentEntry, or null if unusable. */
function toAssessmentEntry(raw: unknown): AssessmentEntry | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const id = typeof r.id === 'string' ? r.id : null
  if (!id) return null
  const status = (['found', 'partial', 'missing', 'unknown'] as const).includes(r.status as any)
    ? (r.status as AssessmentEntry['status'])
    : 'unknown'
  const evidence: AssessmentEntry['evidence'] = []
  if (Array.isArray(r.evidence)) {
    for (const e of r.evidence) {
      if (!e || typeof e !== 'object') continue
      const er = e as Record<string, unknown>
      const document_id = typeof er.document_id === 'string' ? er.document_id : ''
      const summary = typeof er.summary === 'string' ? er.summary : ''
      if (document_id) evidence.push({ document_id, summary })
    }
  }
  return {
    id,
    status,
    evidence,
    notes: typeof r.notes === 'string' ? r.notes : '',
  }
}
