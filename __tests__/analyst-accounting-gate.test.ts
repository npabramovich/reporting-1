import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * The unified Analyst's access boundary.
 *
 * One Analyst serves every section, so what a user may ask about is decided by WHAT THE REQUEST
 * IS GIVEN, not by prompt text: a user who isn't entitled to a domain must never have that
 * domain's data appended to their system prompt, nor its capabilities (accounting's entry
 * drafting) — leaving their Analyst with nothing to answer from and no way to act. The scope
 * arrives in the request body (`vehicle`, `domain`), so it is fully caller-controlled and is
 * never evidence of entitlement; that is checked against the caller's role and the fund's
 * feature settings.
 *
 * These tests pin that per domain, and pin that each domain's data stays out of the others'.
 */

const createChat = vi.hoisted(() => vi.fn())
const buildAccountingContext = vi.hoisted(() => vi.fn(async () => 'PRIMARY VEHICLE BOOKS: cash 100'))
const buildLpContext = vi.hoisted(() => vi.fn(async () => 'LP ROLL-UP: Cranmore commit 5000000'))
const buildDiligenceContext = vi.hoisted(() => vi.fn(async () => 'PIPELINE: 3 deals — 2 active, 1 passed'))
const extractText = vi.hoisted(() => vi.fn(async () => 'CAPITAL CALL NOTICE — $3,750,000 due 2026-07-01'))

let user: { id: string } | null = { id: 'u1' }
let tables: Record<string, unknown> = {}

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({ auth: { getUser: async () => ({ data: { user } }) } }),
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => fakeAdmin }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: async () => null }))
vi.mock('@/lib/ai/usage', () => ({ logAIUsage: vi.fn() }))
vi.mock('@/lib/ai/topical-guard', () => ({ withTopicalGuardrail: (s: string) => s }))
vi.mock('@/lib/ai/context-builder', () => ({
  buildPortfolioContext: async () => ({ systemPrompt: 'You are the Analyst.', portfolioBlock: '', teamNotesBlock: '' }),
  buildCompanyContext: async () => null,
  buildDealContext: async () => null,
}))
vi.mock('@/lib/accounting/agent-tools', () => ({ resolveVehicle: async (_a: unknown, _f: string, g: string) => g }))
vi.mock('@/lib/accounting/assistant', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/accounting/assistant')>()),
  buildAccountingContext,
}))
vi.mock('@/lib/ai/lp-fund-context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ai/lp-fund-context')>()),
  buildLpContext,
}))
vi.mock('@/lib/diligence/analyst-context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/diligence/analyst-context')>()),
  buildDiligenceContext,
}))
vi.mock('@/lib/memo-agent/extract-text', () => ({ extractText }))
vi.mock('@/lib/ai', () => ({
  createFundAIProviderWithOverride: async () => ({
    provider: { createChat },
    model: 'test-model',
    providerType: 'anthropic',
  }),
}))

/** Chainable Supabase stub: every builder method returns itself; awaiting it (or calling
 *  maybeSingle/single) resolves to that table's canned rows. */
function query(table: string): any {
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
const fakeAdmin: any = { from: (table: string) => query(table) }

const REPLY_WITH_DRAFT = `Here's the entry for that purchase.

\`\`\`proposal
{"type":"create","entryId":null,"entryDate":"2026-07-01","memo":"Buy Apogee","sourceType":"manual","postings":[{"accountCode":"1500","amount":3750000,"lpEntity":null},{"accountCode":"1000","amount":-3750000,"lpEntity":null}],"rationale":"Investment funded from cash"}
\`\`\``

async function post(body: Record<string, unknown>) {
  const { POST } = await import('@/app/api/analyst/route')
  const req = { json: async () => body } as any
  const res = await POST(req)
  return { status: res.status, json: await res.json(), system: createChat.mock.calls[0]?.[0]?.system ?? '' }
}

beforeEach(() => {
  vi.clearAllMocks()
  user = { id: 'u1' }
  createChat.mockResolvedValue({ text: REPLY_WITH_DRAFT, usage: {} })
  tables = {
    fund_members: { fund_id: 'f1', role: 'admin' },
    companies: [],
    // Each of these defaults to 'off' or 'admin', so a fund has to switch them on deliberately.
    fund_settings: { feature_visibility: { accounting: 'admin', lps: 'admin', diligence: 'admin' } },
    analyst_conversations: { id: 'conv1' },
  }
})

const msgs = [{ role: 'user' as const, content: 'Draft the entry to buy Apogee for $3.75M' }]

describe('unified Analyst — accounting is access-scoped', () => {
  it('gives an admin the vehicle books and the drafting capability', async () => {
    const { status, json, system } = await post({ messages: msgs, vehicle: 'Fund IV' })

    expect(status).toBe(200)
    expect(system).toContain('=== ACCOUNTING: Fund IV ===')
    expect(system).toContain('PRIMARY VEHICLE BOOKS: cash 100')
    expect(system).toContain('DRAFTING ENTRIES')
    expect(buildAccountingContext).toHaveBeenCalledWith(expect.anything(), 'f1', 'Fund IV')

    // The draft is lifted out of the prose and returned for the user to review + apply.
    expect(json.proposals).toHaveLength(1)
    expect(json.proposals[0].postings).toHaveLength(2)
    expect(json.vehicle).toBe('Fund IV')
    expect(json.reply).not.toContain('```proposal')
    expect(json.reply).toContain("Here's the entry")
  })

  it('gives a viewer NOTHING, even though they asked for a vehicle', async () => {
    tables.fund_members = { fund_id: 'f1', role: 'viewer' }

    const { status, system, json } = await post({ messages: msgs, vehicle: 'Fund IV' })

    expect(status).toBe(200)
    expect(system).not.toContain('ACCOUNTING')
    expect(system).not.toContain('PRIMARY VEHICLE BOOKS')
    expect(system).not.toContain('DRAFTING ENTRIES')
    expect(buildAccountingContext).not.toHaveBeenCalled()
    // No accounting scope was granted, so a fence-shaped string in the reply is just prose —
    // it must not become an appliable draft.
    expect(json.proposals).toEqual([])
    expect(json.vehicle).toBeNull()
  })

  it('gives an admin nothing when the fund has accounting switched off', async () => {
    tables.fund_settings = { feature_visibility: { accounting: 'off' } }

    const { system, json } = await post({ messages: msgs, vehicle: 'Fund IV' })

    expect(system).not.toContain('PRIMARY VEHICLE BOOKS')
    expect(buildAccountingContext).not.toHaveBeenCalled()
    expect(json.proposals).toEqual([])
  })

  it('leaves the portfolio Analyst untouched when no vehicle is in scope', async () => {
    const { status, system, json } = await post({ messages: msgs })

    expect(status).toBe(200)
    expect(system).toContain('You are the Analyst.')
    expect(system).not.toContain('PRIMARY VEHICLE BOOKS')
    expect(buildAccountingContext).not.toHaveBeenCalled()
    expect(json.proposals).toEqual([])
    expect(json.scope).toBeNull()
  })

  it('reads an attached source document into the prompt for an admin', async () => {
    const { status, system } = await post({
      messages: [{ role: 'user', content: 'Record this' }],
      vehicle: 'Fund IV',
      document: { name: 'call-notice.pdf', format: 'pdf', base64: Buffer.from('x').toString('base64') },
    })

    expect(status).toBe(200)
    expect(system).toContain('=== SOURCE DOCUMENT: call-notice.pdf ===')
    expect(system).toContain('CAPITAL CALL NOTICE — $3,750,000')
  })

  it('does not read an attached document for a viewer — it never reaches extraction', async () => {
    tables.fund_members = { fund_id: 'f1', role: 'viewer' }

    const { status, system } = await post({
      messages: [{ role: 'user', content: 'Record this' }],
      vehicle: 'Fund IV',
      document: { name: 'call-notice.pdf', format: 'pdf', base64: Buffer.from('x').toString('base64') },
    })

    expect(status).toBe(200)
    expect(extractText).not.toHaveBeenCalled()
    expect(system).not.toContain('SOURCE DOCUMENT')
  })

  it('rejects an attachment it cannot read rather than answering as if it had it', async () => {
    const { status, json } = await post({
      messages: msgs,
      vehicle: 'Fund IV',
      document: { name: 'photo.png', format: 'png', base64: Buffer.from('x').toString('base64') },
    })

    expect(status).toBe(400)
    expect(json.error).toMatch(/PDF, Word doc, or text file/)
  })
})

describe('unified Analyst — LP and diligence domains', () => {
  it('gives the LP block to an entitled user, and scopes the thread to it', async () => {
    const { status, system, json } = await post({ messages: msgs, domain: 'lps' })

    expect(status).toBe(200)
    expect(system).toContain('=== LP CAPITAL ===')
    expect(system).toContain('LP ROLL-UP: Cranmore commit 5000000')
    // The LP domain is not the accounting domain: no books, and no ability to draft entries.
    expect(system).not.toContain('PRIMARY VEHICLE BOOKS')
    expect(system).not.toContain('DRAFTING ENTRIES')
    expect(json.scope).toBe('lps')
  })

  it('withholds the LP block when the fund keeps LPs admin-only and the caller is a viewer', async () => {
    tables.fund_members = { fund_id: 'f1', role: 'viewer' }

    const { system, json } = await post({ messages: msgs, domain: 'lps' })

    expect(system).not.toContain('LP ROLL-UP')
    expect(buildLpContext).not.toHaveBeenCalled()
    // Denied, so the thread falls back to the portfolio scope rather than opening an LP one.
    expect(json.scope).toBeNull()
  })

  it("gives the LP block to a viewer when the fund has opened LPs to everyone", async () => {
    tables.fund_members = { fund_id: 'f1', role: 'viewer' }
    tables.fund_settings = { feature_visibility: { lps: 'everyone' } }

    const { system } = await post({ messages: msgs, domain: 'lps' })

    expect(system).toContain('LP ROLL-UP')
  })

  it('gives the diligence block to an entitled user', async () => {
    const { system, json } = await post({ messages: msgs, domain: 'diligence' })

    expect(system).toContain('=== DILIGENCE PIPELINE ===')
    expect(system).toContain('PIPELINE: 3 deals')
    expect(system).not.toContain('LP ROLL-UP')
    expect(json.scope).toBe('diligence')
  })

  it('withholds diligence when the fund has it switched off, even from an admin', async () => {
    tables.fund_settings = { feature_visibility: { diligence: 'off' } }

    const { system, json } = await post({ messages: msgs, domain: 'diligence' })

    expect(system).not.toContain('PIPELINE:')
    expect(buildDiligenceContext).not.toHaveBeenCalled()
    expect(json.scope).toBeNull()
  })

  it('403s the inbound-deal scope when the deals feature is not visible to the caller', async () => {
    tables.fund_members = { fund_id: 'f1', role: 'viewer' }
    tables.fund_settings = { feature_visibility: { deals: 'admin' } }

    const { status } = await post({ messages: msgs, dealId: 'd1' })

    expect(status).toBe(403)
    expect(createChat).not.toHaveBeenCalled()
  })
})
