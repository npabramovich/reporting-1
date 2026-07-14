import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * The Heartbeat webhook receiver's authorization boundary.
 *
 * Heartbeat signs nothing, so the high-entropy token in the URL path is the only
 * credential. That makes the REQUEST BODY fully attacker-controlled for anyone who
 * obtains the token — and the body carries a `channelID`. The per-channel opt-in
 * (a fund watches #dealflow, not #general) must therefore be enforced against the
 * channel Heartbeat reports for the thread over our own authenticated GET, never
 * against the channelID the caller claimed.
 *
 * This regressed once: the post-fetch check was skipped whenever the body's
 * channelID already matched a watched channel, so `{ id: <thread in #general>,
 * channelID: <#dealflow's id> }` imported a thread from an unwatched channel and
 * mislabeled its origin. These tests pin the fixed behavior.
 */

const getThread = vi.hoisted(() => vi.fn())
const ingestHeartbeatThread = vi.hoisted(() => vi.fn(async () => ({ result: 'imported', dealId: 'd1', emailId: 'e1' })))
const resolveWebhookSecret = vi.hoisted(() => vi.fn())

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => fakeAdmin }))
vi.mock('@/lib/heartbeat/client', () => ({
  HeartbeatClient: class { getThread = getThread },
  HeartbeatError: class extends Error {},
}))
vi.mock('@/lib/heartbeat/credentials', () => ({
  resolveWebhookSecret,
  markHeartbeatError: vi.fn(async () => {}),
  markHeartbeatOk: vi.fn(async () => {}),
}))
vi.mock('@/lib/heartbeat/ingest', () => ({ ingestHeartbeatThread }))

// The fund watches ONLY 'chan-deals'. 'chan-general' is deliberately not watched.
const fakeAdmin: any = {
  from: () => ({
    select: () => ({
      eq: async () => ({
        data: [{ channel_id: 'chan-deals', channel_name: 'dealflow' }],
      }),
    }),
  }),
}

import { POST } from '@/app/api/webhooks/heartbeat/[token]/route'

function post(body: unknown) {
  return new Request('https://app.test/api/webhooks/heartbeat/tok', {
    method: 'POST',
    body: JSON.stringify(body),
  }) as any
}

const ctx = { params: { token: 'tok' } }

beforeEach(() => {
  vi.clearAllMocks()
  resolveWebhookSecret.mockResolvedValue({ fundId: 'f1', apiKey: 'k', enabled: true })
  ingestHeartbeatThread.mockResolvedValue({ result: 'imported', dealId: 'd1', emailId: 'e1' } as any)
})

describe('heartbeat webhook — token', () => {
  it('404s an unknown token without doing any work', async () => {
    resolveWebhookSecret.mockResolvedValue(null)

    const res = await POST(post({ id: 't1', channelID: 'chan-deals' }), ctx)

    expect(res.status).toBe(404)
    expect(getThread).not.toHaveBeenCalled()
    expect(ingestHeartbeatThread).not.toHaveBeenCalled()
  })
})

describe('heartbeat webhook — channel authorization', () => {
  it('imports a thread that really is in a watched channel', async () => {
    getThread.mockResolvedValue({
      id: 't1', channelId: 'chan-deals', title: 'Acme', text: 'pitch',
      author: { id: null, name: null, email: null }, createdAt: null,
    })

    const res = await POST(post({ id: 't1', channelID: 'chan-deals' }), ctx)

    expect(res.status).toBe(200)
    expect(ingestHeartbeatThread).toHaveBeenCalledOnce()
    expect((ingestHeartbeatThread.mock.calls[0] as any[])[0]).toMatchObject({
      fundId: 'f1',
      channelName: 'dealflow',
    })
  })

  it('REFUSES a thread whose real channel is unwatched, even when the body claims a watched one', async () => {
    // The attack: a valid thread ID from #general, labeled as #dealflow.
    getThread.mockResolvedValue({
      id: 't-general', channelId: 'chan-general', title: 'Lunch', text: 'anyone around?',
      author: { id: null, name: null, email: null }, createdAt: null,
    })

    const res = await POST(post({ id: 't-general', channelID: 'chan-deals' }), ctx)

    expect(res.status).toBe(200) // no retry — this is a decision, not a failure
    expect(await res.json()).toMatchObject({ ignored: 'channel not watched' })
    expect(ingestHeartbeatThread).not.toHaveBeenCalled()
  })

  it('refuses a thread whose channel cannot be established at all', async () => {
    getThread.mockResolvedValue({
      id: 't2', channelId: null, title: null, text: 'orphan',
      author: { id: null, name: null, email: null }, createdAt: null,
    })

    await POST(post({ id: 't2' }), ctx)

    expect(ingestHeartbeatThread).not.toHaveBeenCalled()
  })

  it('short-circuits an unwatched claimed channel without even fetching the thread', async () => {
    const res = await POST(post({ id: 't3', channelID: 'chan-general' }), ctx)

    expect(res.status).toBe(200)
    expect(getThread).not.toHaveBeenCalled()
  })

  it('400s when no thread id is supplied', async () => {
    const res = await POST(post({ channelID: 'chan-deals' }), ctx)
    expect(res.status).toBe(400)
  })
})
