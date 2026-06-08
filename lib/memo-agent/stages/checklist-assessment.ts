import { createAdminClient } from '@/lib/supabase/admin'
import { logAIUsage } from '@/lib/ai/usage'
import { buildSystemPrompt } from '@/lib/memo-agent/prompts/system'
import { buildChecklistAssessmentContent } from '@/lib/memo-agent/prompts/checklist-assessment'
import { getStageProvider } from '@/lib/memo-agent/stage-provider'
import { extractJsonObject } from '@/lib/memo-agent/parse-ai-json'
import type { IngestionOutput } from './ingest'

type Admin = ReturnType<typeof createAdminClient>

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

  await note(`Assessing ${items.length} checklist items against ${docs.length} document${docs.length === 1 ? '' : 's'}…`)
  const content = buildChecklistAssessmentContent({
    dealName,
    stage: dealStage,
    checklist: items,
    perDoc: docs.map(d => ({
      document_id: d.document_id,
      file_name: nameById.get(d.document_id) ?? d.document_id,
      detected_type: d.detected_type,
      summary: d.summary,
      claims: d.claims.map(c => ({ field: c.field, value: c.value })),
    })),
  })

  // The LLM call is the assessment — if it fails or returns nothing usable,
  // the whole job has failed. Throw with the real reason so the worker marks
  // the job as failed (with the cause in job.error) rather than success-with-
  // warnings (which looks like nothing happened to the partner).
  let assessments: AssessmentEntry[] = []
  let rawText = ''
  try {
    const { text, usage } = await provider.createMessage({
      model,
      maxTokens: 4096,
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
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`Checklist assessment LLM call failed: ${msg}`)
  }

  try {
    assessments = parseAssessmentResponse(rawText)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`Checklist assessment response was unparseable: ${msg}. First 200 chars: ${rawText.slice(0, 200)}`)
  }

  if (assessments.length === 0) {
    throw new Error(`Checklist assessment returned no item entries. Model response head: ${rawText.slice(0, 200)}`)
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
  const out: AssessmentEntry[] = []
  for (const raw of items) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    const id = typeof r.id === 'string' ? r.id : null
    if (!id) continue
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
    out.push({
      id,
      status,
      evidence,
      notes: typeof r.notes === 'string' ? r.notes : '',
    })
  }
  return out
}
