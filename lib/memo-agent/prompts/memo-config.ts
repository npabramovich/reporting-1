/**
 * Format the per-deal memo configuration as a prompt block.
 *
 * The block is injected into both the outline and the per-section fill
 * prompts (alongside the existing memoTemplate exemplar) so the model
 * respects partner overrides on style, analyst voice, emphasis, and the
 * per-section include/length recipe.
 */

export type MemoComplexity = 'brief' | 'standard' | 'detailed' | 'comprehensive'

export interface MemoSectionConfig {
  id: string
  title: string
  included: boolean
  /** Partner-added section the agent should draft (vs a built-in schema section). */
  custom?: boolean
  /** For custom sections: a short note on what the agent should cover. */
  cover?: string
}

export interface MemoTemplateConfig {
  style_override?: 'pre_seed' | 'seed' | 'series_a' | 'series_b' | 'growth' | null
  analyst_persona?: string
  // Single proxy for completeness, level of detail, and length. Replaces the
  // older per-section target_paragraphs inputs (still read for back-compat).
  complexity?: MemoComplexity
  emphasis?: string[]
  /** Ordered, user-managed section list (array order = memo order). When present,
   *  it is authoritative for which sections appear and in what order, overriding
   *  the section list/order in memo_output.yaml. */
  sections?: MemoSectionConfig[]
  section_overrides?: Record<string, { included?: boolean; target_paragraphs?: number | null }>
}

// How each complexity level translates into a writing directive. Acts as a
// proxy for completeness, depth of evidence, and length.
const COMPLEXITY_GUIDANCE: Record<MemoComplexity, string> = {
  brief:
    'Complexity: BRIEF. Write a short, high-level memo — cover only the most decision-relevant points. Keep each included section to roughly one tight paragraph; omit minor detail and secondary evidence.',
  standard:
    'Complexity: STANDARD. Write a standard-depth memo — cover each included section adequately with the key evidence and reasoning, roughly one to two paragraphs per section.',
  detailed:
    'Complexity: DETAILED. Write a detailed memo — cover each included section thoroughly, with supporting evidence, reasoning, and relevant nuance, roughly two to three paragraphs per section.',
  comprehensive:
    'Complexity: COMPREHENSIVE. Write an exhaustive memo — cover every included section in depth, surfacing nuances, edge cases, counterarguments, and all material evidence. Use three or more paragraphs per section where the evidence warrants it.',
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
    !!config.complexity ||
    (Array.isArray(config.emphasis) && config.emphasis.some(e => e && e.trim())) ||
    (Array.isArray(config.sections) && config.sections.length > 0) ||
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

  if (config?.complexity && COMPLEXITY_GUIDANCE[config.complexity]) {
    lines.push(COMPLEXITY_GUIDANCE[config.complexity])
  }

  const emphasis = (config?.emphasis ?? []).map(s => (s ?? '').trim()).filter(Boolean)
  if (emphasis.length > 0) {
    lines.push('Points the partner wants emphasized:')
    for (const e of emphasis) lines.push(`  - ${e}`)
  }

  const sections = Array.isArray(config?.sections) ? config!.sections : null
  if (sections && sections.length > 0) {
    // Authoritative, user-defined section set + order. Overrides memo_output.yaml.
    const included = sections.filter(s => s.included !== false)
    lines.push('Memo sections — write EXACTLY these sections, in THIS exact order, and NO others. This overrides the section list and order in memo_output.yaml:')
    included.forEach((s, i) => {
      const title = (s.title ?? s.id).trim()
      if (s.custom) {
        const cover = (s.cover ?? '').trim()
        lines.push(`  ${i + 1}. ${title} [id: ${s.id}] — partner-added section.${cover ? ` Cover: ${cover}` : ''}`)
      } else {
        lines.push(`  ${i + 1}. ${title} [id: ${s.id}]`)
      }
    })
    const omitted = sections.filter(s => s.included === false).map(s => s.id)
    if (omitted.length > 0) {
      lines.push(`Do NOT outline or write these sections: ${omitted.join(', ')}.`)
    }
    lines.push('Use each section\'s [id] as the section_id on its paragraphs, and use its title as the section heading.')
  } else {
    // Legacy fallback — include/exclude only; schema drives order.
    const overrides = config?.section_overrides ?? {}
    const excluded: string[] = []
    for (const [sectionId, ov] of Object.entries(overrides)) {
      if (ov?.included === false) excluded.push(sectionId)
    }
    if (excluded.length > 0) {
      lines.push('Sections to OMIT entirely from the memo (do not outline or write them):')
      for (const id of excluded) lines.push(`  - ${id}`)
    }
  }

  if (guidance) {
    lines.push('Additional partner guidance:')
    lines.push(guidance)
  }

  return lines.join('\n')
}
