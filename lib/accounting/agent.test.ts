import { describe, it, expect } from 'vitest'
import { generateApiKey, hashApiKey, bearerToken, authorizeToolUse, type ResolvedKey } from './api-keys'
import { AGENT_TOOLS, getTool } from './agent-tools'

const key = (role: string, scopes: string[]): ResolvedKey => ({ fundId: 'f', keyId: 'k', userId: 'u', role, scopes })

describe('authorizeToolUse (members read, admins write)', () => {
  it('allows any member to use read tools', () => {
    expect(authorizeToolUse('read', key('viewer', ['read']))).toBeNull()
    expect(authorizeToolUse('read', key('member', ['read']))).toBeNull()
    expect(authorizeToolUse('read', key('admin', ['read', 'write']))).toBeNull()
  })

  it('allows admins with write scope to use write tools', () => {
    expect(authorizeToolUse('write', key('admin', ['read', 'write']))).toBeNull()
  })

  it('blocks non-admins from write tools', () => {
    expect(authorizeToolUse('write', key('member', ['read', 'write']))).toMatch(/admin/i)
    expect(authorizeToolUse('write', key('writer', ['read', 'write']))).toMatch(/admin/i)
  })

  it('blocks an admin whose key is read-only from write tools', () => {
    expect(authorizeToolUse('write', key('admin', ['read']))).toMatch(/read-only/i)
  })
})

describe('api-keys', () => {
  it('generates a prefixed token whose hash is stable and matches', () => {
    const k = generateApiKey()
    expect(k.token.startsWith('lk_')).toBe(true)
    expect(k.prefix).toBe(k.token.slice(0, 11))
    expect(k.hash).toBe(hashApiKey(k.token))
    expect(k.hash).toHaveLength(64) // sha256 hex
  })

  it('produces distinct tokens each call', () => {
    expect(generateApiKey().token).not.toBe(generateApiKey().token)
  })

  it('extracts a Bearer token case-insensitively', () => {
    const req = new Request('https://x.test', { headers: { Authorization: 'Bearer lk_abc123' } })
    expect(bearerToken(req)).toBe('lk_abc123')
    expect(bearerToken(new Request('https://x.test'))).toBeNull()
  })
})

describe('agent tool registry', () => {
  it('every tool has a unique name, description, scope, and object input schema', () => {
    const names = new Set<string>()
    for (const t of AGENT_TOOLS) {
      expect(t.name).toMatch(/^[a-z_]+$/)
      expect(names.has(t.name)).toBe(false)
      names.add(t.name)
      expect(t.description.length).toBeGreaterThan(10)
      expect(['read', 'write']).toContain(t.scope)
      expect(t.inputSchema.type).toBe('object')
      expect(typeof t.handler).toBe('function')
    }
  })

  it('exposes the core ledger operations', () => {
    for (const name of ['list_accounts', 'capital_accounts', 'post_entry', 'allocation', 'reconcile', 'financial_statements', 'run_waterfall']) {
      expect(getTool(name)).toBeDefined()
    }
    expect(getTool('nope')).toBeUndefined()
  })

  it('run_waterfall is a pure tool that needs no DB', async () => {
    const tool = getTool('run_waterfall')!
    const res = await tool.handler(
      { admin: null as any, fundId: 'f', userId: null },
      { distributable: 12_000_000, terms: { carryRate: 0.2 }, state: { contributedCapital: 10_000_000, returnedCapital: 0, preferredPaid: 0, preferredTarget: 800_000, gpCarryPaid: 0 } }
    )
    expect(res.toGP).toBe(400_000)
    expect(res.toLP + res.toGP).toBe(12_000_000)
  })
})
