import { createAdminClient } from '@/lib/supabase/admin'
import { importAffinityIntoDataRoom } from '@/lib/affinity/import'
import { getAffinityKeyForDeal, markAffinityKeyError, markAffinityKeyOk } from '@/lib/affinity/credentials'
import { enqueueIngestForDocuments } from '@/lib/diligence/enqueue-ingest'
import { AffinityError } from '@/lib/affinity/client'

type Admin = ReturnType<typeof createAdminClient>

interface AffinitySyncJob {
  id: string
  fund_id: string
  deal_id: string
  payload: Record<string, unknown>
  enqueued_by?: string | null
}

/**
 * Worker entry point for the `affinity_sync` kind — the ongoing half of the
 * Affinity integration. Pulls anything new since the last run into the data room
 * and queues it for ingest.
 *
 * Runs as the key of the user who linked the deal. If that user has disconnected
 * Affinity (or their key was revoked), the sync stops cleanly and says so rather
 * than failing loudly every hour: a disconnected colleague is an expected state,
 * not an incident. The deal room surfaces it as "sync paused".
 *
 * Import itself is idempotent (deduped on Affinity's note/file ids with partial
 * unique indexes), so a re-run after a partial failure is safe.
 */
export async function runAffinitySyncJob(admin: Admin, job: AffinitySyncJob): Promise<unknown> {
  const { data: deal } = await admin
    .from('diligence_deals')
    .select('id, name, affinity_organization_id, affinity_opportunity_id, deal_status')
    .eq('id', job.deal_id)
    .eq('fund_id', job.fund_id)
    .maybeSingle()

  if (!deal) return { skipped: 'deal not found' }

  const organizationId = (deal as any).affinity_organization_id as number | null
  if (!organizationId) return { skipped: 'deal is not linked to an Affinity company' }

  const cred = await getAffinityKeyForDeal(admin, job.deal_id)
  if (!cred) {
    // Not an error: whoever linked the deal no longer has a usable key.
    return { skipped: 'no usable Affinity key — the linking user has disconnected Affinity' }
  }

  try {
    const result = await importAffinityIntoDataRoom({
      admin,
      apiKey: cred.apiKey,
      fundId: job.fund_id,
      dealId: job.deal_id,
      organizationId,
      opportunityId: (deal as any).affinity_opportunity_id as number | null,
      userId: cred.userId,
    })

    await markAffinityKeyOk(admin, cred.userId)

    let ingestQueued = false
    if (result.documentIds.length > 0) {
      // enqueueIngestForDocuments defers when another job is in flight on this
      // deal. That's fine — the next sync tick finds the same documents still
      // parse_status 'pending' and re-queues them.
      const ingest = await enqueueIngestForDocuments(admin, {
        fundId: job.fund_id,
        dealId: job.deal_id,
        documentIds: result.documentIds,
        enqueuedBy: cred.userId,
      })
      ingestQueued = ingest.enqueued
    }

    return {
      imported: result.imported,
      skipped: result.skipped,
      errors: result.errors,
      ingest_queued: ingestQueued,
    }
  } catch (err) {
    if (err instanceof AffinityError && (err.status === 401 || err.status === 403)) {
      // Flag the credential so the owner sees "reconnect Affinity" in Settings
      // instead of wondering why nothing has synced.
      await markAffinityKeyError(admin, cred.userId, err.message)
    }
    throw err
  }
}
