/* eslint-disable */
/**
 * AUTO-GENERATED FILE — DO NOT EDIT BY HAND.
 * Regenerate with: npm run generate:types
 * Source: lib/memo-agent/schemas/qa_library.schema.json
 */

/**
 * Pool of partner Q&A questions the agent draws from in Stage 3, with categories, skip logic, and cross-references to rubric dimensions.
 */
export interface MemoAgentQALibrary {
  meta?: {
    version?: string
    last_updated?: string
    owner?: string
    notes?: string
    [k: string]: unknown
  }
  batching_rules: {
    questions_per_batch: {
      min: number
      max: number
    }
    ordering?: string
    spacing?: string
    [k: string]: unknown
  }
  skip_logic?: {
    global_rules?: string[]
    [k: string]: unknown
  }
  sensitivity_levels?: {
    [k: string]: string
  }
  /**
   * @minItems 1
   */
  categories: [Category, ...Category[]]
  /**
   * @minItems 1
   */
  questions: [Question, ...Question[]]
}
export interface Category {
  id: string
  name: string
  order: number
}
export interface Question {
  /**
   * Stable ID like 'bg_001'. Do not renumber when removing or rephrasing — IDs track which questions surface signal over time.
   */
  id: string
  /**
   * Must match a category ID defined above.
   */
  category: string
  prompt: string
  intent: string
  kind: 'open_text' | 'yes_no_with_context' | 'single_select' | 'multi_select'
  /**
   * @minItems 1
   */
  feeds_dimensions: [string, ...string[]]
  sensitivity: 'standard' | 'high'
  skip_if_covered_in?: ('data_room' | 'crm_notes' | 'founder_research' | 'prior_session' | 'research_dossier')[]
  reference_signal_in_crm?: string
}
