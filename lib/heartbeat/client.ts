/**
 * Heartbeat REST client (API v0).
 *
 * Docs: https://heartbeat.readme.io/reference/authorization
 * Auth: `Authorization: Bearer <API_KEY>`. The key is issued at the COMMUNITY
 * level and can read every channel — there is no per-user scoping, which is why
 * we store one key per fund and gate it on the admin role.
 *
 * What we use:
 *   GET    /channels                       — list channels for the setup picker
 *   GET    /channels/{channelID}/threads   — the 20 most recent threads (backfill)
 *   GET    /threads/{threadID}             — a single thread's content
 *   GET    /webhooks                       — reconcile what we've registered
 *   PUT    /webhooks                       — register THREAD_CREATE
 *   DELETE /webhooks/{webhookID}           — deregister
 *
 * A NOTE ON RESPONSE SHAPES: Heartbeat's reference documents every request body
 * but publishes no response schema for threads, channels, or users. So nothing
 * here assumes a shape — `normalizeThread` accepts the field spellings the API
 * plausibly uses (text/body/content, user/author/createdBy, id/ID) and each is
 * optional. If Heartbeat returns something we didn't anticipate, the thread still
 * imports with whatever fields we did recognize instead of throwing.
 */

const BASE = 'https://api.heartbeat.chat/v0'

/** The webhook events Heartbeat can fire. We only register THREAD_CREATE. */
export type HeartbeatWebhookAction =
  | 'USER_JOIN' | 'USER_UPDATE' | 'GROUP_JOIN' | 'ABANDONED_CART'
  | 'THREAD_CREATE' | 'MENTION' | 'DIRECT_MESSAGE' | 'COURSE_COMPLETED'
  | 'EVENT_CREATE' | 'EVENT_RSVP' | 'DOCUMENT_CREATE'

export interface HeartbeatChannel {
  id: string
  name: string
}

export interface HeartbeatUser {
  id: string | null
  name: string | null
  email: string | null
}

export interface HeartbeatThread {
  id: string
  channelId: string | null
  /** Heartbeat threads carry rich text; may be HTML. */
  title: string | null
  text: string
  author: HeartbeatUser
  createdAt: string | null
}

export interface HeartbeatWebhook {
  id: string
  action: string
  url: string
  channelId: string | null
}

/** The THREAD_CREATE webhook body. Heartbeat sends IDs only — no content. */
export interface ThreadCreatePayload {
  id: string
  channelID: string
}

export class HeartbeatError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'HeartbeatError'
  }
}

export class HeartbeatClient {
  constructor(private readonly apiKey: string) {}

  private async request<T>(
    path: string,
    init: { method?: string; body?: unknown } = {}
  ): Promise<T> {
    // One retry on 429/5xx. Heartbeat publishes no rate limit; a single backoff
    // covers a transient blip without stalling a user-facing settings save.
    let lastErr: HeartbeatError | null = null

    for (let attempt = 0; attempt < 2; attempt++) {
      let res: Response
      try {
        res = await fetch(`${BASE}${path}`, {
          method: init.method ?? 'GET',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            Accept: 'application/json',
            ...(init.body ? { 'Content-Type': 'application/json' } : {}),
          },
          body: init.body ? JSON.stringify(init.body) : undefined,
        })
      } catch {
        throw new HeartbeatError('Could not reach Heartbeat', 0)
      }

      if (res.ok) {
        if (res.status === 204) return undefined as T
        return (await res.json().catch(() => ({}))) as T
      }

      if (res.status === 401 || res.status === 403) {
        throw new HeartbeatError('Heartbeat rejected the API key', res.status)
      }
      if (res.status === 404) {
        throw new HeartbeatError('Not found in Heartbeat', 404)
      }

      lastErr = new HeartbeatError(
        `Heartbeat returned ${res.status}`,
        res.status
      )
      if (res.status !== 429 && res.status < 500) throw lastErr
      await new Promise(r => setTimeout(r, 1000))
    }

    throw lastErr ?? new HeartbeatError('Heartbeat request failed', 500)
  }

  /**
   * Heartbeat has no `whoami`, so the cheapest authenticated call doubles as key
   * verification: if /channels comes back, the key is live.
   */
  async listChannels(): Promise<HeartbeatChannel[]> {
    const raw = await this.request<unknown>('/channels')
    return asArray(raw)
      .map(c => ({
        id: str(pick(c, 'id', 'ID', '_id')) ?? '',
        name: str(pick(c, 'name', 'title')) ?? 'Untitled channel',
      }))
      .filter(c => c.id)
  }

  /** The 20 most recent threads in a channel. Used by the backfill poll. */
  async listThreads(channelId: string): Promise<HeartbeatThread[]> {
    const raw = await this.request<unknown>(
      `/channels/${encodeURIComponent(channelId)}/threads`
    )
    return asArray(raw)
      .map(t => normalizeThread(t, channelId))
      .filter((t): t is HeartbeatThread => t !== null)
  }

  async getThread(threadId: string): Promise<HeartbeatThread | null> {
    const raw = await this.request<unknown>(`/threads/${encodeURIComponent(threadId)}`)
    // Some REST surfaces wrap the object ({ thread: {...} }); tolerate both.
    const obj = (isRecord(raw) && isRecord(raw.thread)) ? raw.thread : raw
    return normalizeThread(obj, null)
  }

  async listWebhooks(): Promise<HeartbeatWebhook[]> {
    const raw = await this.request<unknown>('/webhooks')
    return asArray(raw)
      .map(w => ({
        id: str(pick(w, 'id', 'ID', '_id')) ?? '',
        action: str(pick(w, 'action', 'event')) ?? '',
        url: str(pick(w, 'url', 'uri')) ?? '',
        channelId: str(pick(w, 'channelID', 'channelId', 'channel_id')),
      }))
      .filter(w => w.id)
  }

  /**
   * Register a THREAD_CREATE webhook, scoped to one channel.
   *
   * Heartbeat documents this as PUT (not POST) on /webhooks. Returns the new
   * webhook's ID so we can delete it when the channel is unwatched — an orphaned
   * webhook would have Heartbeat retrying against a URL we no longer honour.
   */
  async createThreadWebhook(url: string, channelId: string): Promise<string | null> {
    const raw = await this.request<unknown>('/webhooks', {
      method: 'PUT',
      body: { action: 'THREAD_CREATE', url, channelID: channelId },
    })
    const obj = (isRecord(raw) && isRecord(raw.webhook)) ? raw.webhook : raw
    return str(pick(obj, 'id', 'ID', '_id'))
  }

  async deleteWebhook(webhookId: string): Promise<void> {
    await this.request<unknown>(`/webhooks/${encodeURIComponent(webhookId)}`, {
      method: 'DELETE',
    })
  }
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

function normalizeThread(raw: unknown, fallbackChannelId: string | null): HeartbeatThread | null {
  if (!isRecord(raw)) return null

  const id = str(pick(raw, 'id', 'ID', '_id'))
  if (!id) return null

  const authorRaw = pick(raw, 'user', 'author', 'createdBy', 'sender')
  const author = isRecord(authorRaw)
    ? {
        id: str(pick(authorRaw, 'id', 'ID', '_id')),
        name: str(pick(authorRaw, 'name', 'displayName', 'fullName'))
          ?? joinName(str(pick(authorRaw, 'firstName')), str(pick(authorRaw, 'lastName'))),
        email: lower(str(pick(authorRaw, 'email', 'emailAddress'))),
      }
    : { id: null, name: null, email: null }

  return {
    id,
    channelId: str(pick(raw, 'channelID', 'channelId', 'channel_id')) ?? fallbackChannelId,
    title: str(pick(raw, 'title', 'subject', 'name')),
    text: htmlToText(str(pick(raw, 'text', 'body', 'content', 'html')) ?? ''),
    author,
    createdAt: str(pick(raw, 'createdAt', 'created_at', 'createdOn')),
  }
}

/**
 * Heartbeat threads are rich text and may arrive as HTML. The deal analyzer reads
 * plain prose, so flatten tags to text rather than feeding it markup — and drop
 * <script>/<style> bodies entirely so their contents never reach the model as if
 * they were the founder's words.
 */
function htmlToText(input: string): string {
  if (!input.includes('<')) return input.trim()
  return input
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Accept a bare array or a wrapped one ({ data: [...] }, { channels: [...] }). */
function asArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw
  if (!isRecord(raw)) return []
  for (const key of ['data', 'items', 'results', 'channels', 'threads', 'webhooks']) {
    const v = raw[key]
    if (Array.isArray(v)) return v
  }
  return []
}

function pick(obj: unknown, ...keys: string[]): unknown {
  if (!isRecord(obj)) return undefined
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null) return obj[k]
  }
  return undefined
}

function str(v: unknown): string | null {
  if (typeof v === 'string' && v.trim()) return v.trim()
  if (typeof v === 'number') return String(v)
  return null
}

function lower(v: string | null): string | null {
  return v ? v.toLowerCase() : null
}

function joinName(first: string | null, last: string | null): string | null {
  const joined = `${first ?? ''} ${last ?? ''}`.trim()
  return joined || null
}
