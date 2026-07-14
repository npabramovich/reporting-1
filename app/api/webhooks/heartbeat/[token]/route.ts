import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { HeartbeatClient } from '@/lib/heartbeat/client'
import { resolveWebhookSecret, markHeartbeatError, markHeartbeatOk } from '@/lib/heartbeat/credentials'
import { ingestHeartbeatThread } from '@/lib/heartbeat/ingest'

/**
 * Heartbeat THREAD_CREATE receiver. A new thread in a watched channel becomes a
 * deal in /deals.
 *
 * AUTHENTICATION: Heartbeat's webhooks carry no signature and no shared secret —
 * their docs describe no verification mechanism whatsoever. So the high-entropy
 * token in the URL path IS the credential. We hash it and look up the fund; an
 * unknown token is a flat 404 with no further work done. That means:
 *
 *   - The token must never be logged. It is not, anywhere in this file.
 *   - A leaked URL is a leaked credential, so the settings UI re-mints the token
 *     (and re-registers every webhook) whenever the API key is re-saved.
 *   - Anyone who has the token can, at most, make us fetch a thread ID from
 *     Heartbeat with our own key and import it if it exists. They cannot inject
 *     deal CONTENT — the body of this request is only used for its IDs, and the
 *     text always comes from Heartbeat over our authenticated GET. That is the
 *     reason we re-fetch rather than trusting the payload.
 *
 * Heartbeat sends `{ id, channelID }` and nothing else, which is what makes the
 * re-fetch mandatory rather than merely prudent.
 */

export const maxDuration = 120

export async function POST(
  req: NextRequest,
  { params }: { params: { token: string } }
) {
  const admin = createAdminClient()

  const conn = await resolveWebhookSecret(admin, params.token)
  // Unknown token, or the integration is disabled/undecryptable. Same response
  // for all of them — a caller probing tokens learns nothing from the difference.
  if (!conn) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json().catch(() => null)
  const threadId = typeof body?.id === 'string' ? body.id : null
  const channelId = typeof body?.channelID === 'string' ? body.channelID : null
  if (!threadId) {
    return NextResponse.json({ error: 'Missing thread id' }, { status: 400 })
  }

  // Only channels the admin opted into. Heartbeat lets you filter a webhook by
  // channel, but we re-check here rather than trusting that: the registration
  // could have been changed in Heartbeat's own UI, and the whole point of the
  // opt-in list is that the rest of the community is never turned into dealflow.
  const { data: watched } = await (admin as any)
    .from('heartbeat_channels')
    .select('channel_id, channel_name')
    .eq('fund_id', conn.fundId)

  const watchedList = (watched ?? []) as Array<{ channel_id: string; channel_name: string | null }>

  // Cheap pre-filter on the CLAIMED channel, purely to avoid a pointless fetch.
  // This is NOT the authorization check — the body is attacker-controlled, since
  // anyone holding the URL token can post anything to it. The real check is
  // below, against the channel the thread actually belongs to.
  if (channelId && !watchedList.some(c => c.channel_id === channelId)) {
    // Not an error — Heartbeat may be doing what we asked, we just don't want
    // this channel. 200 so it doesn't retry.
    return NextResponse.json({ ok: true, ignored: 'channel not watched' })
  }

  try {
    const client = new HeartbeatClient(conn.apiKey)
    const thread = await client.getThread(threadId)
    if (!thread) {
      return NextResponse.json({ ok: true, ignored: 'thread not found' })
    }

    // THE authorization check. It uses thread.channelId — the channel Heartbeat
    // itself reports for this thread over our authenticated GET — and never the
    // channelID from the request body. Trusting the body would let anyone with
    // the URL token name a watched channel while pointing at a thread from any
    // other channel in the community, importing it and mislabeling its origin.
    // That is exactly the boundary the per-channel opt-in exists to hold.
    //
    // A thread whose channel we cannot establish is not importable, so the null
    // case falls through to "not watched" rather than being waved past.
    const match = watchedList.find(c => c.channel_id === thread.channelId)
    if (!match) {
      return NextResponse.json({ ok: true, ignored: 'channel not watched' })
    }

    const channelName = match.channel_name

    const outcome = await ingestHeartbeatThread({
      admin,
      fundId: conn.fundId,
      thread,
      channelName,
    })

    await markHeartbeatOk(admin, conn.fundId)

    // Always 200. A non-2xx would have Heartbeat retry, and every outcome here —
    // imported, duplicate, too-short — is final. Retrying a duplicate just burns
    // both ends.
    return NextResponse.json({ ok: true, ...outcome })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    console.error('[webhooks/heartbeat] failed:', msg)
    await markHeartbeatError(admin, conn.fundId, msg)
    // 500 here IS worth a retry — this is our failure (or Heartbeat's), not a
    // decision about the thread.
    return NextResponse.json({ error: 'Ingest failed' }, { status: 500 })
  }
}
