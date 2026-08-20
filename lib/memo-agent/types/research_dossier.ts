/* eslint-disable */
/**
 * AUTO-GENERATED FILE — DO NOT EDIT BY HAND.
 * Regenerate with: npm run generate:types
 * Source: lib/memo-agent/schemas/research_dossier.schema.json
 */

/**
 * External research findings, source quality tiers, contradictions, founder research constraints, competitive map.
 */
export interface MemoAgentResearchDossier {
  meta?: {
    [k: string]: unknown
  }
  /**
   * @minItems 1
   */
  research_categories: [
    {
      id: string
      name: string
      description: string
      /**
       * @minItems 1
       */
      feeds_dimensions: [string, ...string[]]
    },
    ...{
      id: string
      name: string
      description: string
      /**
       * @minItems 1
       */
      feeds_dimensions: [string, ...string[]]
    }[]
  ]
  source_quality_tiers: {
    tier_1_authoritative: Tier
    tier_2_credible: Tier
    tier_3_signal: Tier
    tier_4_weak: Tier
    tier_excluded: Tier
  }
  finding_record: RecordWithFields
  contradiction_record: {
    rationale?: string
    /**
     * @minItems 1
     */
    fields: [FieldSpec, ...FieldSpec[]]
    [k: string]: unknown
  }
  founder_research_special_handling: {
    rationale?: string
    /**
     * @minItems 1
     */
    in_scope: [string, ...string[]]
    /**
     * @minItems 1
     */
    out_of_scope: [string, ...string[]]
    alternative_source_taxonomy: {
      primary_sources: {
        id: string
        name: string
        priority: 'high' | 'medium' | 'low'
        note?: string
        [k: string]: unknown
      }[]
      backchannel_signals?: {
        [k: string]: unknown
      }
      [k: string]: unknown
    }
    output_constraints: string[]
    [k: string]: unknown
  }
  competitive_research_special_handling: {
    rationale?: string
    required_outputs: {
      id: string
      name: string
      required?: boolean
      note?: string
      [k: string]: unknown
    }[]
    per_competitor_record: RecordWithFields
    [k: string]: unknown
  }
  research_output: RecordWithFields
}
export interface Tier {
  description: string
  /**
   * @minItems 1
   */
  examples: [string, ...string[]]
  default_confidence?: string
  [k: string]: unknown
}
export interface RecordWithFields {
  description?: string
  /**
   * @minItems 1
   */
  fields: [FieldSpec, ...FieldSpec[]]
  [k: string]: unknown
}
export interface FieldSpec {
  name: string
  type: string
  required?: boolean
  values?: unknown[]
  default?: unknown
  note?: string
  [k: string]: unknown
}
