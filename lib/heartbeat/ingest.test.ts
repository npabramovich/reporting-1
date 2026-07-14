import { describe, it, expect, vi, beforeEach } from 'vitest'

const processDeal = vi.hoisted(() => vi.fn(async () => ({ dealId: 'deal-1', lowFit: false, reviewFlagged: false })))

vi.mock('@/lib/pipeline/processDeal', () => ({ processDeal }))
vi.mock('@/lib/ai/feature-provider', () => ({
  getFeatureProvider: async () => ({ provider: {}, model: 'm', providerType: 'anthropic' }),
}))
vi.mock('@/lib/parsing/extractAttachmentText', () => ({
  extractAttachmentText: async (p: any) => ({ emailBody: p.TextBody, attachments: [] }),
}))

import { ingestHeartbeatThread } from './ingest'
import type { HeartbeatThread } from './client'

/**
 * The two things that can silently corrupt data here:
 *
 *   1. A thread whose author has no email on their Heartbeat profile. If we
 *      invented a placeholder sender (noreply@heartbeat.local), processDeal would
 *      derive `heartbeat.local` as the company domain for EVERY such deal — and
 *      findPriorDeal would then chain each new one onto the last as a duplicate
 *      of an unrelated company. The payload's From must be empty instead.
 *
 *   2. intro_source. The webhook and the poll are redundant on purpose, and the
 *      analyzer must never be the thing that decides a deal came from Heartbeat.
 */

// Minimal fake of the supabase admin client: records inserts, lets us force the
// unique-violation the dedupe invariant depends on.
function fakeAdmin(opts: { threadInsertError?: { code: string } } = {}) {
  const inserts: Record<string, any[]> = {}

  const client: any = {
    from: (table: string) => ({
      insert: (row: any) => {
        inserts[table] ??= []
        inserts[table].push(row)
        const error = table === 'heartbeat_threads' ? (opts.threadInsertError ?? null) : null
        return {
          select: () => ({
            single: async () => (error
              ? { data: null, error }
              : { data: { id: `${table}-id` }, error: null }),
          }),
        }
      },
      // ingest.ts awaits `update(...).eq(...)` directly, so eq() resolves.
      update: () => ({ eq: async () => ({ data: null, error: null }) }),
    }),
  }

  return { client, inserts }
}

const baseThread: HeartbeatThread = {
  id: 'thread-1',
  channelId: 'chan-1',
  title: 'Acme is raising a seed',
  text: 'We are building an AI-native ledger for venture funds and raising $2M.',
  author: { id: 'u1', name: 'Jane Founder', email: 'jane@acme.com' },
  createdAt: '2026-07-14T10:00:00Z',
}

beforeEach(() => processDeal.mockClear())

describe('ingestHeartbeatThread', () => {
  it('pins intro_source to heartbeat rather than letting the analyzer guess', async () => {
    const { client } = fakeAdmin()
    const out = await ingestHeartbeatThread({
      admin: client, fundId: 'f1', thread: baseThread, channelName: 'dealflow',
    })

    expect(out).toMatchObject({ result: 'imported', dealId: 'deal-1' })
    expect(processDeal).toHaveBeenCalledOnce()
    expect((processDeal.mock.calls[0] as any[])[0]).toMatchObject({ introSourceOverride: 'heartbeat' })
  })

  it('passes the author email through as the sender when there is one', async () => {
    const { client } = fakeAdmin()
    await ingestHeartbeatThread({ admin: client, fundId: 'f1', thread: baseThread })

    const { payload } = (processDeal.mock.calls[0] as any[])[0] as any
    expect(payload.From).toBe('jane@acme.com')
  })

  it('leaves the sender EMPTY when the author has no email, so no bogus company_domain is derived', async () => {
    const { client, inserts } = fakeAdmin()
    const anon: HeartbeatThread = {
      ...baseThread,
      author: { id: 'u2', name: 'Anon Poster', email: null },
    }

    await ingestHeartbeatThread({ admin: client, fundId: 'f1', thread: anon })

    const { payload } = (processDeal.mock.calls[0] as any[])[0] as any
    // The whole point: NOT a placeholder address. processDeal does
    //   companyDomain = analysis.company_domain ?? deriveDomain(From)
    // so anything @something here becomes a company domain shared by every
    // anonymous Heartbeat deal.
    expect(payload.From).toBe('')
    expect(payload.FromFull.Email).toBe('')

    // inbound_emails.from_address is NOT NULL, so it still gets a provenance
    // label — but nothing derives a domain from that column.
    expect(inserts.inbound_emails[0].from_address).toBe('heartbeat')
  })

  it('reports duplicate (and never calls the analyzer) when the thread was already claimed', async () => {
    // 23505 = unique_violation on heartbeat_threads(fund_id, thread_id). This is
    // what makes webhook-and-poll redundancy safe.
    const { client } = fakeAdmin({ threadInsertError: { code: '23505' } })

    const out = await ingestHeartbeatThread({ admin: client, fundId: 'f1', thread: baseThread })

    expect(out).toEqual({ result: 'duplicate' })
    expect(processDeal).not.toHaveBeenCalled()
  })

  it('skips threads too short to be a pitch without spending an AI call', async () => {
    const { client } = fakeAdmin()
    const chatter: HeartbeatThread = { ...baseThread, title: '', text: '+1' }

    const out = await ingestHeartbeatThread({ admin: client, fundId: 'f1', thread: chatter })

    expect(out).toMatchObject({ result: 'skipped' })
    expect(processDeal).not.toHaveBeenCalled()
  })

  it('includes the channel and the thread body in what the analyzer reads', async () => {
    const { client } = fakeAdmin()
    await ingestHeartbeatThread({
      admin: client, fundId: 'f1', thread: baseThread, channelName: 'dealflow',
    })

    const { payload } = (processDeal.mock.calls[0] as any[])[0] as any
    expect(payload.TextBody).toContain('dealflow')
    expect(payload.TextBody).toContain('AI-native ledger')
    expect(payload.Subject).toBe('Acme is raising a seed')
  })
})
