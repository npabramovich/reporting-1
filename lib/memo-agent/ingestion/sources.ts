import { createAdminClient } from '@/lib/supabase/admin'

type Admin = ReturnType<typeof createAdminClient>

/**
 * A diligence_documents row enriched with the bytes from storage.
 * Whether it came from direct upload or a Drive folder import doesn't
 * matter at this point — both end up as rows in the same table with a
 * `storage_path` pointing into the diligence-documents bucket.
 */
export interface IngestionFileSource {
  document_id: string
  file_name: string
  file_format: string
  detected_type: string | null
  buffer: Buffer
  byte_size: number
}

/**
 * Load every non-skipped document for a deal, downloading the bytes from
 * Supabase storage. Skipped (`parse_status = 'skipped'`) files are excluded.
 *
 * If `documentIds` is provided, only those are loaded (used for partial
 * re-runs on a single newly-uploaded file).
 */
export async function loadDealDocuments(
  admin: Admin,
  dealId: string,
  fundId: string,
  documentIds?: string[],
): Promise<IngestionFileSource[]> {
  let query = admin
    .from('diligence_documents')
    .select('id, deal_id, fund_id, storage_path, file_name, file_format, file_size_bytes, detected_type, parse_status')
    .eq('deal_id', dealId)
    .eq('fund_id', fundId)
    .neq('parse_status', 'skipped')

  if (documentIds && documentIds.length > 0) {
    query = query.in('id', documentIds)
  }

  const { data, error } = await query
  if (error) throw new Error(`Failed to list deal documents: ${error.message}`)

  const rows = (data ?? []) as Array<{
    id: string
    storage_path: string
    file_name: string
    file_format: string
    file_size_bytes: number | null
    detected_type: string | null
  }>

  // Parallel downloads — Supabase storage handles ~10+ concurrent downloads
  // comfortably, and the alternative (sequential) easily blew past the 120s
  // worker ceiling for multi-doc data rooms before the ingest even started.
  const results = await Promise.all(rows.map(async (row): Promise<IngestionFileSource | null> => {
    const { data: blob, error: dlErr } = await admin.storage
      .from('diligence-documents')
      .download(row.storage_path)
    if (dlErr || !blob) {
      console.warn(`[memo-agent.sources] download failed for ${row.storage_path}:`, dlErr?.message)
      return null
    }
    const arr = await blob.arrayBuffer()
    const buffer = Buffer.from(arr)
    return {
      document_id: row.id,
      file_name: row.file_name,
      file_format: row.file_format.toLowerCase(),
      detected_type: row.detected_type,
      buffer,
      byte_size: row.file_size_bytes ?? buffer.length,
    }
  }))
  return results.filter((s): s is IngestionFileSource => s !== null)
}
