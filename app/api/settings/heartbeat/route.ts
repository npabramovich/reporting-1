import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertAdminAccess } from '@/lib/api-helpers'
import { HeartbeatClient, HeartbeatError } from '@/lib/heartbeat/client'
import {
  saveHeartbeatKey,
  getHeartbeatKey,
  getWebhookSecret,
  deleteHeartbeatKey,
} from '@/lib/heartbeat/credentials'

/**
 * Heartbeat integration settings. ADMIN ONLY, on every verb.
 *
 * The Heartbeat key is a fund-wide credential that can read every channel in the
 * community, so unlike the per-user Affinity key (which is permission-scoped and
 * therefore safe for any member to set), this one is gated on the admin role.
 *
 * The API key is never returned by GET — only whether it exists, matching how the
 * rest of the settings surface handles secrets. The webhook token is never
 * returned either, in any response, ever: it is generated, used immediately to
 * register webhook URLs with Heartbeat, and then only its hash is kept.
 */

/** Where Heartbeat should POST. Mirrors resolveCallbackUrl() in transcribe-job.ts. */
function resolveWebhookBase(): string {
  const explicit = process.env.HEARTBEAT_WEBHOOK_URL
  if (explicit) return explicit.replace(/\/$/, '')

  const base = process.env.NEXT_PUBLIC_SITE_URL
    ?? process.env.VERCEL_PROJECT_PRODUCTION_URL
    ?? process.env.VERCEL_URL
  if (!base) {
    throw new Error('No webhook base URL configured (set HEARTBEAT_WEBHOOK_URL or NEXT_PUBLIC_SITE_URL)')
  }
  return (base.startsWith('http') ? base : `https://${base}`).replace(/\/$/, '')
}

function webhookUrlFor(token: string): string {
  return `${resolveWebhookBase()}/api/webhooks/heartbeat/${token}`
}

// ---------------------------------------------------------------------------
// GET — connection status, the channel picker, and the watched set
// ---------------------------------------------------------------------------

export async function GET() {
  const guard = await adminGuard()
  if ('error' in guard) return guard.error
  const { admin, fundId } = guard

  const { data: cred } = await (admin as any)
    .from('heartbeat_credentials')
    .select('enabled, last_verified_at, last_error')
    .eq('fund_id', fundId)
    .maybeSingle()

  if (!cred) {
    return NextResponse.json({
      connected: false, enabled: false, channels: [], watched: [],
      last_verified_at: null, last_error: null, imported_count: 0,
    })
  }

  const { data: watched } = await (admin as any)
    .from('heartbeat_channels')
    .select('channel_id, channel_name, webhook_id, watch_started_at')
    .eq('fund_id', fundId)
    .order('channel_name')

  // How many deals have actually come in this way. Drives the "is it working?"
  // line in the UI, and (via /api/settings) whether the Deals filter offers
  // Heartbeat as a source at all.
  const { count } = await (admin as any)
    .from('heartbeat_threads')
    .select('id', { count: 'exact', head: true })
    .eq('fund_id', fundId)
    .eq('status', 'imported')

  // The live channel list, so the admin can pick from what's actually in their
  // community. A failure here is not fatal — the connection may still be fine and
  // the watched set is stored locally — so we degrade to "no picker" and say why.
  let channels: Array<{ id: string; name: string }> = []
  let channelsError: string | null = null
  const apiKey = await getHeartbeatKey(admin, fundId)
  if (apiKey) {
    try {
      channels = await new HeartbeatClient(apiKey).listChannels()
    } catch (err) {
      channelsError = err instanceof HeartbeatError ? err.message : 'Could not list Heartbeat channels'
    }
  }

  return NextResponse.json({
    connected: true,
    enabled: !!(cred as any).enabled,
    channels,
    channels_error: channelsError,
    watched: (watched ?? []).map((w: any) => ({
      channel_id: w.channel_id,
      channel_name: w.channel_name,
      webhook_registered: !!w.webhook_id,
      watch_started_at: w.watch_started_at,
    })),
    last_verified_at: (cred as any).last_verified_at ?? null,
    last_error: (cred as any).last_error ?? null,
    imported_count: count ?? 0,
  })
}

// ---------------------------------------------------------------------------
// POST — connect (or replace) the API key
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  const guard = await adminGuard()
  if ('error' in guard) return guard.error
  const { admin, fundId } = guard

  const body = await req.json().catch(() => ({}))
  const apiKey = typeof body.api_key === 'string' ? body.api_key.trim() : ''
  if (!apiKey) return NextResponse.json({ error: 'api_key is required' }, { status: 400 })

  // Verify before storing. Heartbeat has no whoami, so listing channels is the
  // cheapest authenticated call — and it doubles as the picker's data. A key that
  // can't authenticate is worse than no key: ingestion would fail silently.
  let channels
  try {
    channels = await new HeartbeatClient(apiKey).listChannels()
  } catch (err) {
    const message = err instanceof HeartbeatError
      ? err.message
      : 'Could not reach Heartbeat to verify the key'
    return NextResponse.json({ error: message }, { status: 400 })
  }

  // Replacing the key re-mints the webhook token, which invalidates every URL we
  // previously registered. So the old webhooks must be torn down and rebuilt, or
  // Heartbeat would keep POSTing to a token that now 404s.
  const previous = await listWatched(admin, fundId)
  const oldKey = await getHeartbeatKey(admin, fundId)
  if (oldKey && previous.length > 0) {
    await deregisterWebhooks(oldKey, previous.map(p => p.webhook_id).filter(Boolean) as string[])
  }

  let webhookSecret: string
  try {
    ({ webhookSecret } = await saveHeartbeatKey(admin, { fundId, apiKey }))
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to store key' },
      { status: 500 }
    )
  }

  // Re-register the channels that were already being watched, under the new token.
  if (previous.length > 0) {
    await registerWebhooks(admin, fundId, apiKey, webhookSecret, previous.map(p => ({
      channel_id: p.channel_id,
      channel_name: p.channel_name,
    })))
  }

  return NextResponse.json({ connected: true, enabled: true, channels })
}

// ---------------------------------------------------------------------------
// PATCH — set the watched channels, or pause/resume
// ---------------------------------------------------------------------------

export async function PATCH(req: NextRequest) {
  const guard = await adminGuard()
  if ('error' in guard) return guard.error
  const { admin, fundId } = guard

  const body = await req.json().catch(() => ({}))

  // Pause/resume. Keeps the key and the registered webhooks; the receiving route
  // simply stops honouring them (resolveWebhookSecret returns null when disabled).
  if (typeof body.enabled === 'boolean') {
    await (admin as any)
      .from('heartbeat_credentials')
      .update({ enabled: body.enabled, updated_at: new Date().toISOString() })
      .eq('fund_id', fundId)
    return NextResponse.json({ ok: true, enabled: body.enabled })
  }

  if (!Array.isArray(body.channels)) {
    return NextResponse.json({ error: 'channels must be an array' }, { status: 400 })
  }

  const apiKey = await getHeartbeatKey(admin, fundId)
  if (!apiKey) return NextResponse.json({ error: 'Heartbeat is not connected' }, { status: 400 })

  // The desired set, as [{id, name}].
  const desired = (body.channels as unknown[])
    .map(c => {
      if (typeof c === 'string') return { channel_id: c, channel_name: null as string | null }
      if (c && typeof c === 'object') {
        const id = (c as any).channel_id ?? (c as any).id
        if (typeof id !== 'string' || !id) return null
        const name = (c as any).channel_name ?? (c as any).name
        return { channel_id: id, channel_name: typeof name === 'string' ? name : null }
      }
      return null
    })
    .filter((c): c is { channel_id: string; channel_name: string | null } => c !== null)

  const current = await listWatched(admin, fundId)
  const desiredIds = new Set(desired.map(d => d.channel_id))
  const currentIds = new Set(current.map(c => c.channel_id))

  const toAdd = desired.filter(d => !currentIds.has(d.channel_id))
  const toRemove = current.filter(c => !desiredIds.has(c.channel_id))

  // Unwatch: delete the Heartbeat webhook first, THEN our row. If the remote
  // delete fails we still drop the row — the receiving route re-checks the
  // watched set on every delivery, so an orphaned webhook is inert, just noisy.
  if (toRemove.length > 0) {
    await deregisterWebhooks(apiKey, toRemove.map(r => r.webhook_id).filter(Boolean) as string[])
    await (admin as any)
      .from('heartbeat_channels')
      .delete()
      .eq('fund_id', fundId)
      .in('channel_id', toRemove.map(r => r.channel_id))
  }

  // Watch: rebuild the webhook URL from the stored token. The token stays on the
  // server the whole way — it is decrypted here purely to construct the URL we
  // hand to Heartbeat, and is never put in a response.
  if (toAdd.length > 0) {
    const token = await getWebhookSecret(admin, fundId)
    if (!token) {
      return NextResponse.json({
        error: 'Could not read the webhook token for this fund. Re-enter your Heartbeat API key to re-mint it.',
        needs_reconnect: true,
      }, { status: 409 })
    }
    await registerWebhooks(admin, fundId, apiKey, token, toAdd)
  }

  return NextResponse.json({ ok: true, watched: await listWatched(admin, fundId) })
}

// ---------------------------------------------------------------------------
// DELETE — disconnect
// ---------------------------------------------------------------------------

export async function DELETE() {
  const guard = await adminGuard()
  if ('error' in guard) return guard.error
  const { admin, fundId } = guard

  // Tear down the remote webhooks before dropping the key — afterwards we could
  // no longer authenticate to Heartbeat to do it, and they'd retry against a
  // dead URL indefinitely.
  const apiKey = await getHeartbeatKey(admin, fundId)
  const watched = await listWatched(admin, fundId)
  if (apiKey && watched.length > 0) {
    await deregisterWebhooks(apiKey, watched.map(w => w.webhook_id).filter(Boolean) as string[])
  }

  await (admin as any).from('heartbeat_channels').delete().eq('fund_id', fundId)
  await deleteHeartbeatKey(admin, fundId)

  // heartbeat_threads is deliberately NOT deleted: those rows are the provenance
  // of real deals sitting in /deals. Dropping them would orphan the deals and let
  // a reconnect re-import every one of them as a duplicate.
  return NextResponse.json({ connected: false })
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

async function adminGuard() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const admin = createAdminClient()
  const access = await assertAdminAccess(admin, user.id)
  if (access instanceof NextResponse) return { error: access }

  return { admin, fundId: access.fundId, userId: user.id }
}

async function listWatched(admin: any, fundId: string): Promise<Array<{
  channel_id: string; channel_name: string | null; webhook_id: string | null
}>> {
  const { data } = await admin
    .from('heartbeat_channels')
    .select('channel_id, channel_name, webhook_id')
    .eq('fund_id', fundId)
  return (data ?? []) as any
}

/**
 * Register one THREAD_CREATE webhook per channel and record its ID.
 *
 * A registration failure is recorded (webhook_id stays null) but does not fail
 * the request: the hourly backfill poll reads the same watched list and will pick
 * the channel's threads up anyway, just slower. Refusing to watch the channel at
 * all would be a worse outcome than watching it on a delay.
 */
async function registerWebhooks(
  admin: any,
  fundId: string,
  apiKey: string,
  webhookToken: string,
  channels: Array<{ channel_id: string; channel_name: string | null }>
): Promise<void> {
  const client = new HeartbeatClient(apiKey)

  let url: string
  try {
    url = webhookUrlFor(webhookToken)
  } catch {
    // No public base URL (local dev without a tunnel). Watch the channels anyway
    // — the poll covers them — but register nothing.
    url = ''
  }

  for (const ch of channels) {
    let webhookId: string | null = null
    if (url) {
      try {
        webhookId = await client.createThreadWebhook(url, ch.channel_id)
      } catch (err) {
        console.error('[settings/heartbeat] webhook registration failed for', ch.channel_id, err)
      }
    }

    await admin.from('heartbeat_channels').upsert({
      fund_id: fundId,
      channel_id: ch.channel_id,
      channel_name: ch.channel_name,
      webhook_id: webhookId,
    }, { onConflict: 'fund_id,channel_id' })
  }
}

async function deregisterWebhooks(apiKey: string, webhookIds: string[]): Promise<void> {
  if (webhookIds.length === 0) return
  const client = new HeartbeatClient(apiKey)
  for (const id of webhookIds) {
    try {
      await client.deleteWebhook(id)
    } catch (err) {
      // Already gone, or Heartbeat is down. Not worth failing the user's action.
      console.error('[settings/heartbeat] webhook deletion failed for', id, err)
    }
  }
}
