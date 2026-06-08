import type { ContentBlock } from '@/lib/ai/types'
import { stageCalibrationBlock } from './stage-calibration'

/**
 * Build the user-content payload for the checklist-assessment call.
 *
 * The model is given the partner-defined checklist plus the per-document
 * summaries + claims from the data-room ingest. It walks every item and
 * marks it found / partial / missing, with evidence pointing at specific
 * doc_ids, and (where relevant) a short note explaining the assessment.
 */
export function buildChecklistAssessmentContent(params: {
  dealName: string
  stage: string | null
  checklist: Array<{ id: string; section: string | null; label: string }>
  perDoc: Array<{
    document_id: string
    file_name: string
    detected_type: string
    summary: string
    claims: Array<{ field: string; value: string }>
  }>
}): ContentBlock[] {
  const lines: string[] = [
    `Deal: ${params.dealName}`,
    '',
    stageCalibrationBlock(params.stage),
    '',
    'Partner-defined diligence checklist (assess each item):',
    '',
  ]

  for (const item of params.checklist) {
    const prefix = item.section ? `[${item.section}] ` : ''
    lines.push(`- id=${item.id} ${prefix}${item.label}`)
  }

  lines.push('', 'Data-room evidence (per-document summaries + claims):', '')

  for (const doc of params.perDoc) {
    lines.push(`### ${doc.file_name} (doc_id=${doc.document_id}, type=${doc.detected_type})`)
    lines.push(doc.summary || '(no summary)')
    if (doc.claims.length > 0) {
      lines.push('Claims:')
      for (const c of doc.claims.slice(0, 25)) {
        lines.push(`  - ${c.field}: ${c.value}`)
      }
    }
    lines.push('')
  }

  lines.push(CHECKLIST_INSTRUCTIONS)

  return [{ type: 'text', text: lines.join('\n') }]
}

const CHECKLIST_INSTRUCTIONS = `CHECKLIST ASSESSMENT

For every checklist item above, decide whether the data room satisfies it. Be calibrated to the company's stage: at pre-seed/seed almost nothing should be marked "missing" simply because a polished artifact is absent — only mark "missing" if the item is genuinely a stage-appropriate ask the data room does not address.

Status options:
  - "found"   — the data room clearly contains what this item asks for.
  - "partial" — partially addressed; some content is present but key sub-aspects are absent.
  - "missing" — not addressed at all in the data room and stage-appropriate to expect.
  - "unknown" — the item is unclear or requires partner judgment (use sparingly).

For each "found" or "partial" item, populate evidence with up to 3 doc_ids you relied on and a one-line summary per doc. Keep notes terse — 1 sentence max.

Return JSON ONLY:

{
  "items": [
    {
      "id": string,                              // must match a checklist item id above
      "status": "found" | "partial" | "missing" | "unknown",
      "evidence": [
        { "document_id": string, "summary": string }
      ],
      "notes": string                            // optional — only when it adds signal beyond status
    }
  ]
}

Do NOT add items. Do NOT change labels. Only return entries for ids that appear in the checklist above.`
