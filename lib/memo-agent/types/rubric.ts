/* eslint-disable */
/**
 * AUTO-GENERATED FILE — DO NOT EDIT BY HAND.
 * Regenerate with: npm run generate:types
 * Source: lib/memo-agent/schemas/rubric.schema.json
 */

export type Dimension = {
  [k: string]: unknown
} & {
  [k: string]: unknown
} & {
  /**
   * Stable ID — referenced by qa_library.yaml. Do not rename without updating cross-references.
   */
  id: string
  name: string
  mode: 'machine' | 'partner_only' | 'hybrid'
  description: string
  sources?: string[]
  criteria?: {
    /**
     * This interface was referenced by `undefined`'s JSON-Schema definition
     * via the `patternProperty` "^[0-9]+$".
     */
    [k: string]: string
  }
  signals_to_consider?: string[]
  flag_low_confidence_when?: string[]
  /**
   * Required only when mode = partner_only. Cross-reference to qa_library.yaml category IDs.
   */
  informed_by_qa_categories?: string[]
  /**
   * Inline behavioral instruction. Required for partner_only dimensions.
   */
  agent_behavior?: string
} & {
  /**
   * Stable ID — referenced by qa_library.yaml. Do not rename without updating cross-references.
   */
  id: string
  name: string
  mode: 'machine' | 'partner_only' | 'hybrid'
  description: string
  sources?: string[]
  criteria?: {
    /**
     * This interface was referenced by `undefined`'s JSON-Schema definition
     * via the `patternProperty` "^[0-9]+$".
     */
    [k: string]: string
  }
  signals_to_consider?: string[]
  flag_low_confidence_when?: string[]
  /**
   * Required only when mode = partner_only. Cross-reference to qa_library.yaml category IDs.
   */
  informed_by_qa_categories?: string[]
  /**
   * Inline behavioral instruction. Required for partner_only dimensions.
   */
  agent_behavior?: string
}

/**
 * Defines what gets scored in an investment memo, on what scale, by whom (machine vs partner), and what evidence supports each score.
 */
export interface MemoAgentRubric {
  meta?: {
    version?: string
    last_updated?: string
    owner?: string
    notes?: string
    [k: string]: unknown
  }
  scoring_scale: {
    type: 'integer'
    /**
     * @minItems 2
     * @maxItems 2
     */
    range: [number, number]
    levels: {
      /**
       * This interface was referenced by `undefined`'s JSON-Schema definition
       * via the `patternProperty` "^[0-9]+$".
       */
      [k: string]: string
    }
  }
  /**
   * @minItems 1
   */
  confidence_levels: ['low' | 'medium' | 'high', ...('low' | 'medium' | 'high')[]]
  scoring_modes: {
    machine: {
      description: string
    }
    partner_only: {
      description: string
    }
    hybrid: {
      description: string
    }
  }
  /**
   * @minItems 1
   */
  dimensions: [Dimension, ...Dimension[]]
  overall_recommendation?: {
    mode: 'partner_only'
    description: string
    conventional_options?: string[]
    [k: string]: unknown
  }
}
