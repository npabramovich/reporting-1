import { createAdminClient } from '@/lib/supabase/admin'
import { logAIUsage } from '@/lib/ai/usage'
import { buildSystemPrompt } from '@/lib/memo-agent/prompts/system'
import { buildIngestDocContent, buildIngestSynthesisContent } from '@/lib/memo-agent/prompts/ingest'
import { getStageProvider } from '@/lib/memo-agent/stage-provider'
import { loadDealDocuments } from '@/lib/memo-agent/ingestion/sources'
import { parseAll, type ParsedFile } from '@/lib/memo-agent/ingestion/parsers'

type Admin = ReturnType<typeof createAdminClient>

export interface IngestionDocumentOutput {
  document_id: string
  detected_type: string
  type_confidence: 'low' | 'medium' | 'high'
  summary: string
  claims: Array<{
    id: string
    field: string
    value: string
    context: string
    verification_status: 'unverified'
    criticality: 'high' | 'medium' | 'low'
  }>
  issues?: string[]
}

export interface IngestionGap {
  expected_type?: string
  document_id?: string
  criticality: 'blocker' | 'important' | 'nice_to_have'
  rationale: string
}

export interface IngestionOutput {
  documents: IngestionDocumentOutput[]
  gap_analysis: {
    missing: IngestionGap[]
    inadequate: IngestionGap[]
  }
  cross_doc_flags: Array<{ description: string; doc_ids: string[] }>
}

export interface IngestionResult {
  draft_id: string
  ingestion_output: IngestionOutput
  documents_processed: number
  warnings: string[]
}

/**
 * Stage 1 — data-room ingestion.
 *
 * Fans out one AI call per parsed document in parallel (Promise.all), then
 * runs a single small synthesis call over the per-doc summaries to compute
 * gap_analysis + cross_doc_flags. This keeps total wall-clock close to the
 * slowest single doc rather than the sum, so multi-doc data rooms fit inside
 * the 120s Vercel function ceiling instead of orphaning at `running`.
 */
export async function runIngest(params: {
  admin: Admin
  fundId: string
  dealId: string
  documentIds?: string[]
  draftId?: string
  progressCb?: (msg: string) => Promise<void>
}): Promise<IngestionResult> {
  const { admin, fundId, dealId, documentIds, progressCb } = params
  const note = async (msg: string) => { if (progressCb) await progressCb(msg) }

  await note('Loading documents…')
  const sources = await loadDealDocuments(admin, dealId, fundId, documentIds)
  if (sources.length === 0) {
    throw new Error('No documents to ingest. Upload files to the deal room first.')
  }

  await note(`Parsing ${sources.length} document${sources.length === 1 ? '' : 's'}…`)
  const parsed = await parseAll(sources)

  await note('Building system prompt…')
  const { prompt: system } = await buildSystemPrompt({ admin, fundId, stage: 'ingest' })

  await note('Loading deal record…')
  const { data: dealRow } = await admin
    .from('diligence_deals')
    .select('name')
    .eq('id', dealId)
    .eq('fund_id', fundId)
    .maybeSingle()
  const dealName = (dealRow as { name: string } | null)?.name ?? 'this deal'

  const { provider, model, providerType } = await getStageProvider(admin, fundId, 'ingest')

  const manifest = parsed.map(f => ({
    file_name: f.file_name,
    file_format: f.file_format,
    detected_type: f.detected_type,
  }))

  // Per-document fan-out.
  await note(`Extracting claims from ${parsed.length} document${parsed.length === 1 ? '' : 's'} in parallel…`)
  const warnings: string[] = []
  let completed = 0

  const perDocResults = await Promise.all(parsed.map(async (file): Promise<IngestionDocumentOutput | null> => {
    // Skip files with parse errors and no usable content — surface a warning,
    // mark the doc as failed downstream, and exclude it from the AI fan-out
    // so a single bad PPTX doesn't burn an AI call.
    if (file.errors.length > 0 && !file.text && !file.base64) {
      warnings.push(`Skipping ${file.file_name}: ${file.errors.join('; ')}`)
      return null
    }

    try {
      const { text, usage } = await provider.createMessage({
        model,
        maxTokens: 8192,
        system,
        content: buildIngestDocContent({ dealName, file, manifest }),
      })
      logAIUsage(admin, {
        fundId,
        provider: providerType,
        model,
        feature: 'memo_agent_ingest',
        usage,
      })
      const doc = parsePerDocResponse(text, file.document_id)
      completed += 1
      await note(`Extracted ${completed}/${parsed.length}: ${file.file_name}`)
      return doc
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      warnings.push(`AI call failed for ${file.file_name}: ${msg}`)
      completed += 1
      await note(`Extracted ${completed}/${parsed.length}: ${file.file_name} (failed)`)
      return null
    }
  }))

  const documents = perDocResults.filter((d): d is IngestionDocumentOutput => d !== null)

  // Synthesis call — runs only if we have at least one successful doc. With
  // zero successful docs we fall through with empty cross-doc results rather
  // than spending another AI call on nothing.
  let gapAnalysis: IngestionOutput['gap_analysis'] = { missing: [], inadequate: [] }
  let crossDocFlags: IngestionOutput['cross_doc_flags'] = []

  if (documents.length > 0) {
    await note('Synthesizing data-room gap analysis…')
    try {
      const synthesisContent = buildIngestSynthesisContent({
        dealName,
        perDoc: documents.map(d => ({
          document_id: d.document_id,
          file_name: parsed.find(p => p.document_id === d.document_id)?.file_name ?? d.document_id,
          detected_type: d.detected_type,
          summary: d.summary,
          claim_fields: d.claims.map(c => c.field),
          claim_values: d.claims.map(c => ({ field: c.field, value: c.value })),
        })),
      })

      const { text, usage } = await provider.createMessage({
        model,
        maxTokens: 4096,
        system,
        content: synthesisContent,
      })
      logAIUsage(admin, {
        fundId,
        provider: providerType,
        model,
        feature: 'memo_agent_ingest_synthesis',
        usage,
      })
      const synth = parseSynthesisResponse(text)
      gapAnalysis = synth.gap_analysis
      crossDocFlags = synth.cross_doc_flags
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      warnings.push(`Synthesis call failed: ${msg}. Continuing without gap_analysis/cross_doc_flags.`)
    }
  }

  const output: IngestionOutput = {
    documents,
    gap_analysis: gapAnalysis,
    cross_doc_flags: crossDocFlags,
  }

  await note('Writing ingestion output to draft…')
  const draftId = await persistDraft(admin, fundId, dealId, output, params.draftId)

  // Parallelize classification updates for the successfully-extracted docs
  // and failure marks for the un-extracted ones.
  await note('Updating document classifications…')
  const successIds = new Set(documents.map(d => d.document_id))
  await Promise.all([
    ...documents.map(doc =>
      admin
        .from('diligence_documents')
        .update({
          detected_type: doc.detected_type,
          type_confidence: doc.type_confidence,
          parse_status: 'parsed',
        } as any)
        .eq('id', doc.document_id)
        .eq('deal_id', dealId)
        .eq('fund_id', fundId)
    ),
    ...parsed
      .filter(file => !successIds.has(file.document_id))
      .map(file =>
        admin
          .from('diligence_documents')
          .update({
            parse_status: 'failed',
            parse_notes: file.errors.length > 0 ? file.errors.join('; ') : 'AI extraction failed',
          } as any)
          .eq('id', file.document_id)
          .eq('deal_id', dealId)
          .eq('fund_id', fundId)
      ),
  ])

  await admin
    .from('diligence_deals')
    .update({ current_memo_stage: 'research' } as any)
    .eq('id', dealId)
    .eq('fund_id', fundId)

  return {
    draft_id: draftId,
    ingestion_output: output,
    documents_processed: documents.length,
    warnings,
  }
}

// ---------------------------------------------------------------------------
// Persist
// ---------------------------------------------------------------------------

async function persistDraft(
  admin: Admin,
  fundId: string,
  dealId: string,
  output: IngestionOutput,
  draftId?: string,
): Promise<string> {
  if (draftId) {
    const { error } = await admin
      .from('diligence_memo_drafts')
      .update({ ingestion_output: output as any })
      .eq('id', draftId)
      .eq('deal_id', dealId)
      .eq('fund_id', fundId)
    if (error) throw new Error(`Failed to update draft: ${error.message}`)
    return draftId
  }

  // Find the most recent in-progress draft to update; create if none.
  const { data: existing } = await admin
    .from('diligence_memo_drafts')
    .select('id')
    .eq('deal_id', dealId)
    .eq('fund_id', fundId)
    .eq('is_draft', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existing) {
    const id = (existing as { id: string }).id
    const { error } = await admin
      .from('diligence_memo_drafts')
      .update({ ingestion_output: output as any })
      .eq('id', id)
    if (error) throw new Error(`Failed to update draft: ${error.message}`)
    return id
  }

  const version = `v0.1-ingest-${new Date().toISOString().slice(0, 10)}`
  const { data: created, error: insertErr } = await admin
    .from('diligence_memo_drafts')
    .insert({
      deal_id: dealId,
      fund_id: fundId,
      draft_version: version,
      agent_version: 'memo-agent v0.1',
      ingestion_output: output as any,
    } as any)
    .select('id')
    .single()
  if (insertErr || !created) throw new Error(`Failed to create draft: ${insertErr?.message ?? 'unknown'}`)
  return (created as { id: string }).id
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

function stripCodeFence(raw: string): string {
  return raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
}

function parsePerDocResponse(raw: string, expectedDocId: string): IngestionDocumentOutput {
  const cleaned = stripCodeFence(raw)
  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    throw new Error(`Ingest AI returned non-JSON: ${cleaned.slice(0, 300)}`)
  }
  const doc = coerceDocument(parsed)
  if (!doc) throw new Error('Ingest AI response missing required fields (document_id, detected_type)')
  // Trust our doc_id over the model's — the model occasionally rewrites it.
  doc.document_id = expectedDocId
  return doc
}

function parseSynthesisResponse(raw: string): { gap_analysis: IngestionOutput['gap_analysis']; cross_doc_flags: IngestionOutput['cross_doc_flags'] } {
  const cleaned = stripCodeFence(raw)
  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    throw new Error(`Synthesis AI returned non-JSON: ${cleaned.slice(0, 300)}`)
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Synthesis AI returned non-object JSON')
  }
  const obj = parsed as Record<string, unknown>
  const gap = (obj.gap_analysis as any) ?? {}
  return {
    gap_analysis: {
      missing: Array.isArray(gap.missing) ? gap.missing.map(coerceGap).filter(Boolean) as IngestionGap[] : [],
      inadequate: Array.isArray(gap.inadequate) ? gap.inadequate.map(coerceGap).filter(Boolean) as IngestionGap[] : [],
    },
    cross_doc_flags: Array.isArray(obj.cross_doc_flags) ? obj.cross_doc_flags as IngestionOutput['cross_doc_flags'] : [],
  }
}

function coerceDocument(raw: unknown): IngestionDocumentOutput | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.document_id !== 'string' || typeof r.detected_type !== 'string') return null
  const conf = ['low', 'medium', 'high'].includes(r.type_confidence as string) ? r.type_confidence as 'low' | 'medium' | 'high' : 'low'
  return {
    document_id: r.document_id,
    detected_type: r.detected_type,
    type_confidence: conf,
    summary: typeof r.summary === 'string' ? r.summary : '',
    claims: Array.isArray(r.claims) ? r.claims.map(coerceClaim).filter(Boolean) as IngestionDocumentOutput['claims'] : [],
    issues: Array.isArray(r.issues) ? r.issues.filter(s => typeof s === 'string') as string[] : undefined,
  }
}

function coerceClaim(raw: unknown): IngestionDocumentOutput['claims'][number] | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.field !== 'string' || typeof r.value !== 'string') return null
  const crit = ['high', 'medium', 'low'].includes(r.criticality as string) ? r.criticality as 'high' | 'medium' | 'low' : 'medium'
  return {
    id: typeof r.id === 'string' ? r.id : `claim_${Math.random().toString(36).slice(2, 8)}`,
    field: r.field,
    value: r.value,
    context: typeof r.context === 'string' ? r.context : '',
    verification_status: 'unverified',
    criticality: crit,
  }
}

function coerceGap(raw: unknown): IngestionGap | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const crit = ['blocker', 'important', 'nice_to_have'].includes(r.criticality as string)
    ? r.criticality as IngestionGap['criticality']
    : 'important'
  if (typeof r.rationale !== 'string') return null
  return {
    expected_type: typeof r.expected_type === 'string' ? r.expected_type : undefined,
    document_id: typeof r.document_id === 'string' ? r.document_id : undefined,
    criticality: crit,
    rationale: r.rationale,
  }
}

// ParsedFile type re-exported for callers that previously imported through this module.
export type { ParsedFile }
