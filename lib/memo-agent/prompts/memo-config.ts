/**
 * Format the per-deal memo configuration as a prompt block.
 *
 * The block is injected into both the outline and the per-section fill
 * prompts (alongside the existing memoTemplate exemplar) so the model
 * respects partner overrides on style, analyst voice, emphasis, and the
 * per-section include/length recipe.
 */

export interface MemoTemplateConfig {
  style_override?: 'pre_seed' | 'seed' | 'series_a' | 'series_b' | 'growth' | null
  analyst_persona?: string
  emphasis?: string[]
  section_overrides?: Record<string, { included?: boolean; target_paragraphs?: number | null }>
}

export function buildMemoConfigBlock(params: {
  partnerGuidance?: string
  config?: MemoTemplateConfig | null
}): string {
  const guidance = (params.partnerGuidance ?? '').trim()
  const config = params.config ?? null
  const hasConfig = !!config && (
    !!config.style_override ||
    !!(config.analyst_persona && config.analyst_persona.trim()) ||
    (Array.isArray(config.emphasis) && config.emphasis.some(e => e && e.trim())) ||
    (config.section_overrides && Object.keys(config.section_overrides).length > 0)
  )
  if (!guidance && !hasConfig) return ''

  const lines: string[] = []
  lines.push('=== PER-DEAL MEMO CONFIG (partner-authored — follow it exactly) ===')

  if (config?.style_override) {
    lines.push(`Style override: treat this memo as a ${config.style_override.replace('_', ' ')} memo, regardless of the deal record's stage_at_consideration. Calibrate expectations, evidence requirements, and tone accordingly.`)
  }

  if (config?.analyst_persona && config.analyst_persona.trim()) {
    lines.push(`Analyst persona: ${config.analyst_persona.trim()}`)
  }

  const emphasis = (config?.emphasis ?? []).map(s => (s ?? '').trim()).filter(Boolean)
  if (emphasis.length > 0) {
    lines.push('Points the partner wants emphasized:')
    for (const e of emphasis) lines.push(`  - ${e}`)
  }

  const overrides = config?.section_overrides ?? {}
  const excluded: string[] = []
  const lengthTargets: Array<{ section_id: string; paragraphs: number }> = []
  for (const [sectionId, ov] of Object.entries(overrides)) {
    if (ov?.included === false) excluded.push(sectionId)
    if (typeof ov?.target_paragraphs === 'number' && ov.target_paragraphs > 0) {
      lengthTargets.push({ section_id: sectionId, paragraphs: ov.target_paragraphs })
    }
  }

  if (excluded.length > 0) {
    lines.push('Sections to OMIT entirely from the memo (do not outline or write them):')
    for (const id of excluded) lines.push(`  - ${id}`)
  }

  if (lengthTargets.length > 0) {
    lines.push('Section-level paragraph targets (write approximately this many paragraphs per section):')
    for (const t of lengthTargets) lines.push(`  - ${t.section_id}: ${t.paragraphs} paragraph${t.paragraphs === 1 ? '' : 's'}`)
  }

  if (guidance) {
    lines.push('Additional partner guidance:')
    lines.push(guidance)
  }

  return lines.join('\n')
}
