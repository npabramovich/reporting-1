import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { HeartbeatClient } from '@/lib/heartbeat/client'
import { getHeartbeatKey, markHeartbeatError, markHeartbeatOk } from '@/lib/heartbeat/credentials'
import { ingestHeartbeatThread } from '@/lib/heartbeat/ingest'

/**
 * Heartbeat backfill poll. Runs hourly and pulls the recent threads of every
 * watched channel, importing any the webhook didn't deliver.
 *
 * This is a SAFETY NET, not the primary path — the THREAD_CREATE webhook is, and
 * it lands deals in seconds. The poll exists because a webhook is a single point
 * of failure that fails silently: if the app was down, or the deploy URL changed,
 * or an admin deleted the webhook inside Heartbeat, dealflow would just stop
 * arriving and nobody would notice. Re-reading the channel catches all of that.
 *
 * Double delivery is expected and safe: ingestHeartbeatThread claims each thread
 * against the unique (fund_id, thread_id) index before doing any work, so a
 * thread the webhook already imported is a no-op here.
 *
 * Auth: the same `Authorization: Bearer ${CRON_SECRET}` pattern as the other crons.
 */

export const maxDuration = 300

// Heartbeat's list endpoint returns only the 20 most recent threads per channel
// and offers no pagination or since-filter, so an hour is about the longest gap
// this can actually cover for a busy channel. It is not a reason to poll harder:
// the webhook is the real path, and a channel posting >20 pitches an hour is not
// a thing.
const THREADS_PER_CHANNEL = 20

// Stop well short of maxDuration — each import is an LLM call, and being killed
// mid-flight would leave a thread claimed as 'pending' with no deal (see the
// reclaim sweep below, which is what cleans that up).
const TIME_BUDGET_MS = 240_000

// How long a thread may sit in 'pending' before we assume the run that claimed it
// died. Comfortably longer than the webhook route's 120s maxDuration, so we can
// never reclaim a thread that is merely still being worked on.
const STALE_PENDING_MS = 15 * 60 * 1000

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  }
  if (req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const started = Date.now()
  const admin = createAdminClient()

  // Only funds with the integration switched on.
  const { data: creds, error } = await (admin as any)
    .from('heartbeat_credentials')
    .select('fund_id')
    .eq('enabled', true)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const funds = ((creds ?? []) as Array<{ fund_id: string }>).map(c => c.fund_id)
  if (funds.length === 0) return NextResponse.json({ ok: true, imported: 0 })

  // ---------------------------------------------------------------------------
  // Reclaim stale claims, BEFORE polling.
  //
  // ingestHeartbeatThread claims a thread ('pending') before doing any work, and
  // the unique (fund_id, thread_id) index is what makes webhook-and-poll
  // redundancy safe. But that same index turns a crash into permanent data loss:
  // if the function is killed mid-import (Vercel's maxDuration, an OOM), the row
  // stays 'pending' forever, and every subsequent delivery — the webhook's retry
  // AND this poll — hits the unique violation and returns 'duplicate'. The thread
  // would never become a deal and nothing would ever say so.
  //
  // Deleting the stale claim frees the thread to be re-claimed on this very run.
  // Only rows that produced no deal are eligible, so a successful import is never
  // reprocessed.
  const staleBefore = new Date(Date.now() - STALE_PENDING_MS).toISOString()
  const { data: reclaimedRows } = await (admin as any)
    .from('heartbeat_threads')
    .delete()
    .eq('status', 'pending')
    .is('deal_id', null)
    .lt('created_at', staleBefore)
    .select('id')
  const reclaimed = ((reclaimedRows ?? []) as unknown[]).length
  if (reclaimed > 0) {
    console.warn(`[cron/heartbeat-backfill] reclaimed ${reclaimed} stale pending thread claim(s)`)
  }

  let imported = 0
  let scanned = 0
  let skippedBudget = 0

  for (const fundId of funds) {
    if (Date.now() - started > TIME_BUDGET_MS) { skippedBudget++; continue }

    const apiKey = await getHeartbeatKey(admin, fundId)
    if (!apiKey) continue

    const { data: channels } = await (admin as any)
      .from('heartbeat_channels')
      .select('channel_id, channel_name, watch_started_at')
      .eq('fund_id', fundId)

    const watched = (channels ?? []) as Array<{
      channel_id: string; channel_name: string | null; watch_started_at: string
    }>
    if (watched.length === 0) continue

    const client = new HeartbeatClient(apiKey)

    for (const ch of watched) {
      if (Date.now() - started > TIME_BUDGET_MS) { skippedBudget++; break }

      let threads
      try {
        threads = await client.listThreads(ch.channel_id)
        await markHeartbeatOk(admin, fundId)
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error'
        console.error('[cron/heartbeat-backfill] listThreads failed:', ch.channel_id, msg)
        await markHeartbeatError(admin, fundId, msg)
        continue
      }

      const watchStart = new Date(ch.watch_started_at).getTime()

      for (const thread of threads.slice(0, THREADS_PER_CHANNEL)) {
        if (Date.now() - started > TIME_BUDGET_MS) { skippedBudget++; break }

        // Never import threads that predate the channel being watched. Otherwise
        // connecting the integration would retroactively manufacture a deal for
        // every old post in the channel's history.
        if (thread.createdAt && new Date(thread.createdAt).getTime() < watchStart) continue

        scanned++
        const outcome = await ingestHeartbeatThread({
          admin,
          fundId,
          thread,
          channelName: ch.channel_name,
        })
        if (outcome.result === 'imported') imported++
      }

      await (admin as any)
        .from('heartbeat_channels')
        .update({ last_polled_at: new Date().toISOString() })
        .eq('fund_id', fundId)
        .eq('channel_id', ch.channel_id)
    }
  }

  // Report what we DIDN'T do. A backfill that silently ran out of time looks
  // identical to one that found nothing, and that's exactly the failure this
  // whole endpoint exists to prevent.
  return NextResponse.json({
    ok: true,
    funds: funds.length,
    scanned,
    imported,
    reclaimed,
    skipped_time_budget: skippedBudget,
  })
}
