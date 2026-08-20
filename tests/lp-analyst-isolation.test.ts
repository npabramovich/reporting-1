import { describe, it, expect } from 'vitest'
import { buildLpAnalystTools } from '@/lib/ai/lp-analyst-tools'

/**
 * Cross-tenant safety: LP tools are hard-scoped to the caller's closed-over investorIds. Passing a
 * DIFFERENT investor's id (or snapshot id) in the tool input must change nothing — the tools never
 * read investor identity from input. Beta's figures must never surface for an Alpha-scoped caller.
 */

const ALPHA_COMMITMENT = 1_000_000
const BETA_MARKER = 9_999_999

const tableData: Record<string, any[]> = {
  lp_snapshot_shares: [{ lp_snapshots: { id: 's1', name: 'Q2 2026', as_of_date: '2026-06-30' } }],
  lp_investments: [
    {
      id: 'i1', entity_id: 'e1', portfolio_group: 'Fund IV',
      commitment: ALPHA_COMMITMENT, total_value: 1_400_000, nav: 1_200_000,
      called_capital: 800_000, paid_in_capital: 800_000, distributions: 200_000, irr: 0.18,
      lp_entities: { id: 'e1', entity_name: 'Alpha LP', investor_id: 'inv1', lp_investors: { id: 'inv1', name: 'Alpha' } },
    },
    {
      id: 'i2', entity_id: 'e2', portfolio_group: 'Fund IV',
      commitment: BETA_MARKER, total_value: BETA_MARKER, nav: BETA_MARKER,
      called_capital: BETA_MARKER, paid_in_capital: BETA_MARKER, distributions: 0, irr: 0.99,
      lp_entities: { id: 'e2', entity_name: 'Beta LP', investor_id: 'inv2', lp_investors: { id: 'inv2', name: 'Beta' } },
    },
  ],
}

function makeAdmin() {
  const build = (table: string) => {
    const b: any = {
      select: () => b,
      eq: () => b,
      in: () => b,
      not: () => b,
      order: () => b,
      then: (r: any) => Promise.resolve({ data: tableData[table] ?? [], error: null }).then(r),
    }
    return b
  }
  return { from: (t: string) => build(t) } as any
}

// Caller is scoped to Alpha (inv1) only.
const tools = () => buildLpAnalystTools({ admin: makeAdmin(), fundId: 'f1', investorIds: ['inv1'] })

// Every attempt to name Beta via input.
const HOSTILE_INPUTS = [
  { investorIds: ['inv2'] },
  { lp_investor_id: 'inv2' },
  { investor_id: 'inv2' },
  { snapshotId: 'anything' },
]

describe('LP analyst tools are hard-scoped to the caller investors', () => {
  it('get_capital_account ignores an input-provided investor id', async () => {
    const { executeTool } = tools()
    for (const input of HOSTILE_INPUTS) {
      const parsed = JSON.parse(await executeTool({ name: 'get_capital_account', input }))
      expect(parsed.commitment).toBe(ALPHA_COMMITMENT)
      expect(JSON.stringify(parsed)).not.toContain(String(BETA_MARKER))
    }
  })

  it('get_performance never leaks another investor figures', async () => {
    const { executeTool } = tools()
    for (const input of HOSTILE_INPUTS) {
      const raw = await executeTool({ name: 'get_performance', input })
      expect(raw).not.toContain(String(BETA_MARKER))
      expect(raw).not.toContain('Beta')
    }
  })

  it('list_statements returns only shared statements regardless of input', async () => {
    const { executeTool } = tools()
    const raw = await executeTool({ name: 'list_statements', input: { investorIds: ['inv2'] } })
    expect(raw).not.toContain('Beta')
  })
})
