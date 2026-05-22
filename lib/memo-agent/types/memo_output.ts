/* eslint-disable */
/**
 * AUTO-GENERATED FILE — DO NOT EDIT BY HAND.
 * Regenerate with: npm run generate:types
 * Source: lib/memo-agent/schemas/memo_output.schema.json
 */

/**
 * Memo assembly format with paragraph-level provenance, partner-only fields, and draft-only enforcement.
 */
export interface MemoAgentMemoOutput {
  meta?: {
    [k: string]: unknown
  }
  memo_structure: {
    description?: string
    /**
     * @minItems 1
     */
    sections: [Section, ...Section[]]
    [k: string]: unknown
  }
  paragraph_record: RecordWithFields
  source_reference: RecordWithFields
  score_block: RecordWithFields
  partner_attention: {
    description?: string
    item_record: RecordWithFields
    [k: string]: unknown
  }
  citation_map: {
    description?: string
    entry_record: RecordWithFields
    [k: string]: unknown
  }
  memo_draft_output: RecordWithFields
  /**
   * @minItems 1
   */
  hard_rules: [
    {
      id: string
      rule: string
    },
    ...{
      id: string
      rule: string
    }[]
  ]
}
export interface Section {
  id: string
  title: string
  kind: 'metadata' | 'prose' | 'partner_only' | 'hybrid' | 'structured'
  max_paragraphs?: number
  fields?: string[]
  partner_only_fields?: string[]
  machine_fields?: string[]
  sources?: string[]
  feeds_score?: string
  guidance?: string
  agent_behavior?: string
  content?: string
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
