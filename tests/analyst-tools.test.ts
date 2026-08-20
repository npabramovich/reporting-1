import { describe, it, expect } from 'vitest'
import { buildAnalystTools } from '@/lib/ai/analyst-tools'
import type { AccessContext } from '@/lib/access/effective'
import { DEFAULT_FEATURE_VISIBILITY, type FeatureVisibilityMap } from '@/lib/types/features'

// The fund-level ceiling is open for accounting; the caller's per-domain GRANT is the axis under
// test (mirrors lib/access/effective.test.ts, which opens the feature and varies the grant).
function ctx(grants: Partial<Record<string, 'read' | 'write'>>): AccessContext {
  return {
    fundId: 'f1',
    userId: 'u1',
    role: 'member',
    features: { ...DEFAULT_FEATURE_VISIBILITY, accounting: 'everyone' } as FeatureVisibilityMap,
    grants: grants as any,
    defaults: {},
  } as AccessContext
}

describe('buildAnalystTools (read-only)', () => {
  it('exposes only read tools the caller can access', () => {
    const { tools } = buildAnalystTools({
      admin: {} as any,
      fundId: 'f1',
      userId: 'u1',
      access: ctx({ accounting: 'read' }),
    })
    const names = tools.map(t => t.name)
    expect(names).toContain('list_accounts') // accounting read
    expect(names).not.toContain('record_investment') // write scope, excluded in Phase A
  })

  it('omits tools for denied domains', () => {
    // Ceiling open, but no grant → member has no accounting access, so no accounting tools.
    const { tools } = buildAnalystTools({
      admin: {} as any,
      fundId: 'f1',
      userId: 'u1',
      access: ctx({}),
    })
    expect(tools.map(t => t.name)).not.toContain('list_accounts')
  })
})
