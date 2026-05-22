/* eslint-disable */
/**
 * AUTO-GENERATED FILE — DO NOT EDIT BY HAND.
 * Regenerate with: npm run generate:types
 * Source: lib/memo-agent/schemas/style_anchors.schema.json
 */

/**
 * Defines metadata for uploaded reference memos that teach the agent the firm's voice, structure, and analytical patterns.
 */
export interface MemoAgentStyleAnchors {
  meta?: {
    [k: string]: unknown
  }
  usage_principles: Rule[]
  memo_record: {
    description?: string
    fields: FieldSpec[]
  }
  attention_taxonomy: {
    voice_dimensions: TaxonomyEntry[]
    structure_dimensions: TaxonomyEntry[]
    analytical_dimensions: TaxonomyEntry[]
  }
  aggregation: {
    default_weighting: 'equal' | 'recency_weighted' | 'conviction_weighted' | 'partner_marked'
    alternative_weightings?: {
      id: string
      description: string
    }[]
    conflict_resolution: {
      rule: string
    }
    minimum_useful_count?: {
      [k: string]: unknown
    }
    [k: string]: unknown
  }
  style_synthesis?: {
    [k: string]: unknown
  }
  guardrails: Rule[]
}
export interface Rule {
  id: string
  rule: string
}
export interface FieldSpec {
  name: string
  type: string
  required?: boolean
  default?: unknown
  values?: unknown[]
  note?: string
  [k: string]: unknown
}
export interface TaxonomyEntry {
  id: string
  name: string
}
