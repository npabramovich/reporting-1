/* eslint-disable */
/**
 * AUTO-GENERATED FILE — DO NOT EDIT BY HAND.
 * Regenerate with: npm run generate:types
 * Source: lib/memo-agent/schemas/data_room_ingestion.schema.json
 */

/**
 * Per-document extraction format, claim provenance, financial-model handling, and gap analysis for the data room ingestion stage.
 */
export interface MemoAgentDataRoomIngestion {
  meta?: {
    [k: string]: unknown
  }
  provenance_default: {
    source_type: 'company_stated'
    rationale: string
  }
  /**
   * @minItems 1
   */
  document_types: [DocumentType, ...DocumentType[]]
  expected_documents: {
    description?: string
    expected: {
      id: string
      criticality: 'required' | 'expected' | 'optional'
    }[]
    [k: string]: unknown
  }
  document_record: RecordWithFields
  claim_record: RecordWithFields
  financial_extraction: {
    rationale: string
    /**
     * @minItems 1
     */
    metrics_to_extract: [
      {
        id: string
        name: string
        units: 'currency' | 'percent' | 'ratio' | 'months' | 'count' | 'number'
        historical?: 'required' | 'optional'
        projected?: 'required' | 'optional'
        [k: string]: unknown
      },
      ...{
        id: string
        name: string
        units: 'currency' | 'percent' | 'ratio' | 'months' | 'count' | 'number'
        historical?: 'required' | 'optional'
        projected?: 'required' | 'optional'
        [k: string]: unknown
      }[]
    ]
    metric_record: RecordWithFields
    assumption_record: RecordWithFields
    rules: string[]
  }
  gap_analysis: {
    description?: string
    output_record: RecordWithFields
    [k: string]: unknown
  }
  ingestion_output: {
    fields: FieldSpec[]
    [k: string]: unknown
  }
}
export interface DocumentType {
  id: string
  name: string
  /**
   * @minItems 1
   */
  typical_formats: [string, ...string[]]
  typical_content?: string[]
  extraction_priority: 'high' | 'medium' | 'low'
  special_handling?: string
  note?: string
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
