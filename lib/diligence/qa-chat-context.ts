import type { createAdminClient } from '@/lib/supabase/admin'
import type { IngestionOutput } from '@/lib/memo-agent/stages/ingest'
import type { ResearchOutput } from '@/lib/memo-agent/stages/research'

type Admin = ReturnType<typeof createAdminClient>

export interface QAChatContext {
  dealName: string
  stage: string | null
  text: string                                      // pre-formatted evidence block ready to drop into the prompt
  citableDocs: Array<{ id: string; file_name: string }>  // ids the model is allowed to cite
}

/**
 * Build the evidence context the Q&A chat agent answers from. Pulls per-doc
 * summaries + claims from ingestion, the research dossier, the Q&A library,
 * and the checklist — formats it as a single text block that fits inside one
 * LLM prompt. Truncates aggressively so we don't blow the context window on
 * data-rich deals.
 */
export async function buildQAChatContext(params: {
  admin: Admin
  fundId: string
  dealId: string
}): Promise<QAChatContext> {
  const { admin, fundId, dealId } = params

  // Deal name + stage for calibration.
  const { data: dealRow } = await admin
    .from('diligence_deals')
    .select('name, stage_at_consideration')
    .eq('id', dealId)
    .eq('fund_id', fundId)
    .maybeSingle()
  const dealName = (dealRow as { name: string } | null)?.name ?? 'this deal'
  const dealStage = (dealRow as { stage_at_consideration: string | null } | null)?.stage_at_consideration ?? null

  // Latest draft — carries ingestion_output, research_output, qa_answers.
  const { data: draftRow } = await admin
    .from('diligence_memo_drafts')
    .select('id, ingestion_output, research_output, qa_answers')
    .eq('deal_id', dealId)
    .eq('fund_id', fundId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const ingestion = ((draftRow as any)?.ingestion_output ?? {}) as Partial<IngestionOutput>
  const research = ((draftRow as any)?.research_output ?? null) as ResearchOutput | null
  const qaAnswers = Array.isArray((draftRow as any)?.qa_answers) ? (draftRow as any).qa_answers as any[] : []

  // Resolve human file names — ingestion_output only carries document_ids.
  const docIds = (ingestion.documents ?? []).map(d => d.document_id).filter(Boolean)
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
  const citableDocs = (ingestion.documents ?? []).map(d => ({
    id: d.document_id,
    file_name: nameById.get(d.document_id) ?? d.document_id,
  }))

  // Checklist — labels + status only (no evidence, to save tokens).
  const { data: checklistRows } = await (admin as any)
    .from('diligence_checklist_items')
    .select('id, kind, parent_id, label, status, agent_notes')
    .eq('deal_id', dealId)
    .eq('fund_id', fundId)
    .order('order_index', { ascending: true })
  const checklistItems = ((checklistRows ?? []) as Array<{
    id: string; kind: string; parent_id: string | null; label: string; status: string; agent_notes: string | null
  }>)

  // ---------- compose text ----------
  const lines: string[] = []
  lines.push(`Deal: ${dealName}${dealStage ? ` (stage: ${dealStage})` : ''}`)
  lines.push('')

  // Data room
  if (ingestion.documents && ingestion.documents.length > 0) {
    lines.push('### DATA-ROOM EVIDENCE')
    for (const doc of ingestion.documents) {
      const name = nameById.get(doc.document_id) ?? doc.document_id
      lines.push(`- ${name} (doc_id=${doc.document_id}, type=${doc.detected_type}) — ${doc.summary || '(no summary)'}`)
      // Only high + medium criticality claims to keep tokens in check.
      const claims = doc.claims.filter(c => c.criticality !== 'low').slice(0, 20)
      for (const c of claims) {
        lines.push(`    · ${c.field}: ${c.value}`)
      }
    }
    if (ingestion.gap_analysis) {
      const blockers = ingestion.gap_analysis.missing.filter(g => !g.dismissed && g.criticality === 'blocker')
      if (blockers.length > 0) {
        lines.push('')
        lines.push('Data-room gaps flagged as blockers:')
        for (const g of blockers) lines.push(`  · ${g.expected_type ?? 'unknown'}: ${g.rationale}`)
      }
    }
    lines.push('')
  } else {
    lines.push('### DATA-ROOM EVIDENCE')
    lines.push('(no ingestion output yet — the data room has not been processed)')
    lines.push('')
  }

  // Research
  if (research) {
    lines.push('### RESEARCH')
    if (research.findings.length > 0) {
      lines.push('Findings:')
      for (const f of research.findings.slice(0, 40)) {
        lines.push(`  · [${f.verification_status}] ${f.topic} — ${f.evidence}`)
      }
    }
    if (research.contradictions.length > 0) {
      lines.push('Contradictions:')
      for (const c of research.contradictions) {
        lines.push(`  · [${c.severity}] ${c.topic}: ${c.description}`)
      }
    }
    if (research.founder_dossiers.length > 0) {
      lines.push('Founders:')
      for (const f of research.founder_dossiers) {
        lines.push(`  · ${f.founder_name} (${f.role}) — ${f.background_summary}`)
      }
    }
    if (research.competitive_map.named_by_company.length > 0 || research.competitive_map.named_by_research.length > 0) {
      lines.push('Competitors:')
      for (const c of research.competitive_map.named_by_company) lines.push(`  · ${c.name} (company-stated)${c.note ? ` — ${c.note}` : ''}`)
      for (const c of research.competitive_map.named_by_research) lines.push(`  · ${c.name} (research-surfaced) — ${c.rationale}`)
    }
    if (research.research_gaps.length > 0) {
      lines.push('Open research gaps:')
      for (const g of research.research_gaps) lines.push(`  · [${g.criticality}] ${g.topic} — ${g.rationale}`)
    }
    lines.push('')
  }

  // Q&A library (partner-authored + agent-answered)
  if (qaAnswers.length > 0) {
    lines.push('### Q&A LIBRARY')
    for (const q of qaAnswers.slice(0, 30)) {
      const qt = q.question_text ?? q.question_id ?? '(question)'
      const at = q.answer_text ?? '(no answer)'
      lines.push(`Q: ${qt}`)
      lines.push(`A: ${at}`)
    }
    lines.push('')
  }

  // Checklist
  if (checklistItems.length > 0) {
    lines.push('### DILIGENCE CHECKLIST (status per item)')
    const sectionLabelById = new Map<string, string>()
    for (const r of checklistItems) if (r.kind === 'section') sectionLabelById.set(r.id, r.label)
    let lastSection = ''
    for (const r of checklistItems.filter(r => r.kind === 'item').slice(0, 80)) {
      const section = r.parent_id ? sectionLabelById.get(r.parent_id) ?? '' : ''
      if (section && section !== lastSection) {
        lines.push(`-- ${section}`)
        lastSection = section
      }
      lines.push(`  · [${r.status}] ${r.label}${r.agent_notes ? ` — ${r.agent_notes}` : ''}`)
    }
    lines.push('')
  }

  return {
    dealName,
    stage: dealStage,
    text: lines.join('\n'),
    citableDocs,
  }
}
