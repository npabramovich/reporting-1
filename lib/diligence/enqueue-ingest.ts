import type { SupabaseClient } from '@supabase/supabase-js'
import { kickWorker } from '@/lib/memo-agent/kick'

/**
 * Enqueue an ingest job for documents that just landed in a deal's data room
 * from an external source (Affinity sync, accepted inbound email).
 *
 * Ingesting is what turns a raw file into claims with stable ids — the thing the
 * memo cites. A document that is never ingested sits in the data room invisible
 * to every agent stage, so any importer that skips this has only half-imported.
 *
 * Scoped to the new document ids rather than a full re-ingest: a full run would
 * re-pay for every document already parsed.
 */
export async function enqueueIngestForDocuments(
  admin: SupabaseClient,
  params: { fundId: string; dealId: string; documentIds: string[]; enqueuedBy?: string | null }
): Promise<{ enqueued: boolean; reason?: string }> {
  if (params.documentIds.length === 0) return { enqueued: false, reason: 'no new documents' }

  // The worker claims one job per deal at a time. If a job is already in flight,
  // enqueueing a second would have it race the first over the same draft row —
  // so we defer, and the documents stay parse_status 'pending' for the next run.
  const { data: activeJob } = await admin
    .from('memo_agent_jobs')
    .select('id')
    .eq('deal_id', params.dealId)
    .eq('fund_id', params.fundId)
    .in('status', ['pending', 'running'])
    .limit(1)
    .maybeSingle()

  if (activeJob) return { enqueued: false, reason: 'another agent job is already running on this deal' }

  const { error } = await admin
    .from('memo_agent_jobs')
    .insert({
      fund_id: params.fundId,
      deal_id: params.dealId,
      kind: 'ingest',
      payload: { document_ids: params.documentIds },
      enqueued_by: params.enqueuedBy ?? null,
    } as any)

  if (error) return { enqueued: false, reason: error.message }

  // Drain now rather than waiting up to 3 minutes for the cron tick.
  await kickWorker()
  return { enqueued: true }
}
