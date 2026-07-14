import { describe, it, expect, vi, afterEach } from 'vitest'
import { HeartbeatClient, HeartbeatError } from './client'

/**
 * Heartbeat publishes request schemas but NO response schemas for threads,
 * channels, or webhooks. The client therefore normalizes defensively across the
 * field spellings the API plausibly uses. These tests pin that behavior, because
 * the failure mode if it's wrong is silent: a thread imports as an empty deal
 * rather than throwing.
 */

function mockFetch(body: unknown, status = 200) {
  const fn = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }))
  vi.stubGlobal('fetch', fn)
  return fn
}

afterEach(() => vi.unstubAllGlobals())

describe('HeartbeatClient.getThread', () => {
  it('normalizes the documented shape', async () => {
    mockFetch({
      id: 't1',
      channelID: 'c1',
      title: 'Acme is raising',
      text: 'We are building X and raising a $2M seed.',
      user: { id: 'u1', name: 'Jane Founder', email: 'JANE@acme.com' },
      createdAt: '2026-07-14T10:00:00Z',
    })

    const thread = await new HeartbeatClient('k').getThread('t1')

    expect(thread).toEqual({
      id: 't1',
      channelId: 'c1',
      title: 'Acme is raising',
      text: 'We are building X and raising a $2M seed.',
      author: { id: 'u1', name: 'Jane Founder', email: 'jane@acme.com' },
      createdAt: '2026-07-14T10:00:00Z',
    })
  })

  it('accepts alternate field spellings (body/author/firstName+lastName)', async () => {
    mockFetch({
      _id: 't2',
      channel_id: 'c2',
      body: 'pitch text',
      author: { ID: 'u2', firstName: 'Sam', lastName: 'Smith', emailAddress: 'sam@b.io' },
      created_at: '2026-07-01T00:00:00Z',
    })

    const thread = await new HeartbeatClient('k').getThread('t2')

    expect(thread?.id).toBe('t2')
    expect(thread?.channelId).toBe('c2')
    expect(thread?.text).toBe('pitch text')
    expect(thread?.author).toEqual({ id: 'u2', name: 'Sam Smith', email: 'sam@b.io' })
  })

  it('unwraps a { thread: ... } envelope', async () => {
    mockFetch({ thread: { id: 't3', text: 'hi' } })
    const thread = await new HeartbeatClient('k').getThread('t3')
    expect(thread?.id).toBe('t3')
  })

  it('flattens HTML to prose and drops script bodies', async () => {
    mockFetch({
      id: 't4',
      text: '<p>We raised <b>$2M</b>.</p><script>alert(1)</script><ul><li>Point</li></ul>',
    })

    const thread = await new HeartbeatClient('k').getThread('t4')

    // The script's contents must never reach the analyzer as if they were the
    // founder's words.
    expect(thread?.text).not.toContain('alert')
    expect(thread?.text).not.toContain('<')
    expect(thread?.text).toContain('We raised $2M.')
    expect(thread?.text).toContain('• Point')
  })

  it('tolerates a thread with no author and no title', async () => {
    mockFetch({ id: 't5', text: 'anon post' })
    const thread = await new HeartbeatClient('k').getThread('t5')
    expect(thread?.author).toEqual({ id: null, name: null, email: null })
    expect(thread?.title).toBeNull()
  })

  it('returns null when the payload has no usable id', async () => {
    mockFetch({ text: 'orphan' })
    expect(await new HeartbeatClient('k').getThread('t6')).toBeNull()
  })
})

describe('HeartbeatClient.listChannels', () => {
  it('accepts a bare array', async () => {
    mockFetch([{ id: 'c1', name: 'deals' }, { id: 'c2', name: 'general' }])
    const channels = await new HeartbeatClient('k').listChannels()
    expect(channels).toEqual([{ id: 'c1', name: 'deals' }, { id: 'c2', name: 'general' }])
  })

  it('accepts a wrapped array', async () => {
    mockFetch({ data: [{ id: 'c1', name: 'deals' }] })
    const channels = await new HeartbeatClient('k').listChannels()
    expect(channels).toHaveLength(1)
  })

  it('drops entries with no id rather than importing an id-less channel', async () => {
    mockFetch([{ name: 'broken' }, { id: 'c1', name: 'ok' }])
    const channels = await new HeartbeatClient('k').listChannels()
    expect(channels).toEqual([{ id: 'c1', name: 'ok' }])
  })
})

describe('auth', () => {
  it('sends the API key as a bearer token', async () => {
    const fn = mockFetch([])
    await new HeartbeatClient('secret-key').listChannels()

    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.heartbeat.chat/v0/channels')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer secret-key')
  })

  it('raises a typed error on 401 so the settings route can say "bad key"', async () => {
    mockFetch({}, 401)
    await expect(new HeartbeatClient('bad').listChannels()).rejects.toBeInstanceOf(HeartbeatError)
  })
})
