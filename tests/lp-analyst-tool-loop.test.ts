import { describe, it, expect, beforeEach, vi } from 'vitest'

const createChat = vi.hoisted(() => vi.fn())
const createToolLoop = vi.hoisted(() => vi.fn())
const supportsToolLoop = vi.hoisted(() => ({ value: false }))
const buildLpAnalystTools = vi.hoisted(() => vi.fn(() => ({ tools: [{ name: 'get_capital_account' }], executeTool: async () => '' })))

let user: { id: string } | null = { id: 'u1' }
let investorIds: string[] = ['inv1']
let portalOn = true

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({ auth: { getUser: async () => ({ data: { user } }) } }),
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => fakeAdmin }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: async () => null }))
vi.mock('@/lib/ai/usage', () => ({ logAIUsage: vi.fn() }))
vi.mock('@/lib/ai/topical-guard', () => ({ withTopicalGuardrail: (s: string) => s }))
vi.mock('@/lib/api-helpers', () => ({ resolveLpAccess: async () => ({ investorIds }) }))
vi.mock('@/lib/ai/lp-analyst-context', () => ({
  buildLpAnalystContext: async () => ({ documentsBlock: '', lettersBlock: '', statementsBlock: 'S', hasContent: true }),
}))
vi.mock('@/lib/ai/lp-analyst-tools', () => ({ buildLpAnalystTools }))
vi.mock('@/lib/ai', () => ({
  createFundAIProviderWithOverride: async () => ({
    provider: {
      createChat,
      createToolLoop,
      get supportsToolLoop() {
        return supportsToolLoop.value
      },
    },
    model: 'test-model',
    providerType: 'anthropic',
  }),
}))

function query(table: string): any {
  const tables: Record<string, unknown> = {
    lp_investors: { fund_id: 'f1' },
    fund_settings: { lp_portal_enabled: portalOn },
  }
  const result = { data: tables[table] ?? null, error: null }
  const handler: ProxyHandler<any> = {
    get(_t, prop) {
      if (prop === 'then') return (res: any) => Promise.resolve(result).then(res)
      if (prop === 'maybeSingle' || prop === 'single') return async () => result
      return () => proxy
    },
  }
  const proxy: any = new Proxy({}, handler)
  return proxy
}
const fakeAdmin: any = { from: (t: string) => query(t) }

async function post(messages: unknown) {
  const { POST } = await import('@/app/api/portal/analyst/route')
  const res = await POST({ json: async () => ({ messages }) } as any)
  return { status: res.status, json: await res.json() }
}

beforeEach(() => {
  vi.clearAllMocks()
  user = { id: 'u1' }
  investorIds = ['inv1']
  portalOn = true
  supportsToolLoop.value = false
})

describe('LP portal analyst — tool loop', () => {
  it('runs createToolLoop scoped to the caller investorIds when supported', async () => {
    supportsToolLoop.value = true
    createToolLoop.mockResolvedValue({ text: 'your NAV is 1.2M', usage: { inputTokens: 1, outputTokens: 1 }, toolCalls: [] })

    const { status, json } = await post([{ role: 'user', content: 'what is my NAV?' }])

    expect(status).toBe(200)
    expect(buildLpAnalystTools).toHaveBeenCalledWith({ admin: expect.anything(), fundId: 'f1', investorIds: ['inv1'] })
    expect(createToolLoop).toHaveBeenCalled()
    expect(json.reply).toBe('your NAV is 1.2M')
  })

  it('falls back to createChat when the provider lacks tool support', async () => {
    supportsToolLoop.value = false
    createChat.mockResolvedValue({ text: 'plain', usage: { inputTokens: 1, outputTokens: 1 } })

    const { status, json } = await post([{ role: 'user', content: 'hi' }])

    expect(status).toBe(200)
    expect(createChat).toHaveBeenCalled()
    expect(createToolLoop).not.toHaveBeenCalled()
    expect(json.reply).toBe('plain')
  })

  it('404s with the kill-switch off, before building any tools', async () => {
    portalOn = false
    supportsToolLoop.value = true

    const { status } = await post([{ role: 'user', content: 'hi' }])

    expect(status).toBe(404)
    expect(buildLpAnalystTools).not.toHaveBeenCalled()
    expect(createToolLoop).not.toHaveBeenCalled()
  })
})
