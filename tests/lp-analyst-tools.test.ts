import { describe, it, expect, beforeEach } from 'vitest'
import { buildLpAnalystTools } from '@/lib/ai/lp-analyst-tools'

let inCalls: Array<{ col: string; vals: unknown }> = []

const tableData: Record<string, any[]> = {
  lp_snapshot_shares: [{ lp_snapshots: { id: 's1', name: 'Q2 2026', as_of_date: '2026-06-30' } }],
  lp_investments: [
    {
      id: 'i1',
      entity_id: 'e1',
      portfolio_group: 'Fund IV',
      commitment: 1_000_000,
      total_value: 1_400_000,
      nav: 1_200_000,
      called_capital: 800_000,
      paid_in_capital: 800_000,
      distributions: 200_000,
      irr: 0.18,
      lp_entities: { id: 'e1', entity_name: 'Alpha LP', investor_id: 'inv1', lp_investors: { id: 'inv1', name: 'Alpha' } },
    },
    // A different investor's row that must NEVER surface — the tools ignore it.
    {
      id: 'i2',
      entity_id: 'e2',
      portfolio_group: 'Fund IV',
      commitment: 9_999_999,
      total_value: 9_999_999,
      nav: 9_999_999,
      called_capital: 9_999_999,
      paid_in_capital: 9_999_999,
      distributions: 0,
      irr: 0.99,
      lp_entities: { id: 'e2', entity_name: 'Beta LP', investor_id: 'inv2', lp_investors: { id: 'inv2', name: 'Beta' } },
    },
  ],
}

function makeAdmin() {
  const build = (table: string) => {
    const b: any = {
      select: () => b,
      eq: () => b,
      in: (col: string, vals: unknown) => {
        inCalls.push({ col, vals })
        return b
      },
      not: () => b,
      order: () => b,
      then: (r: any) => Promise.resolve({ data: tableData[table] ?? [], error: null }).then(r),
    }
    return b
  }
  return { from: (t: string) => build(t) } as any
}

const deps = () => ({ admin: makeAdmin(), fundId: 'f1', investorIds: ['inv1'] })

beforeEach(() => {
  inCalls = []
})

describe('buildLpAnalystTools', () => {
  it('exposes only read tools', () => {
    const { tools } = buildLpAnalystTools(deps())
    const names = tools.map(t => t.name)
    expect(names).toEqual(expect.arrayContaining(['get_capital_account', 'list_statements', 'get_performance']))
  })

  it('scopes queries by the caller investorIds', async () => {
    const { executeTool } = buildLpAnalystTools(deps())
    await executeTool({ name: 'get_capital_account', input: {} })
    expect(inCalls.some(c => c.col === 'lp_investor_id' && JSON.stringify(c.vals) === JSON.stringify(['inv1']))).toBe(true)
  })

  it('returns only the caller investor figures, never another investor rows', async () => {
    const { executeTool } = buildLpAnalystTools(deps())
    const res = await executeTool({ name: 'get_capital_account', input: {} })
    const parsed = JSON.parse(res)
    // Alpha's commitment is 1,000,000 — Beta's 9,999,999 must not leak in.
    expect(parsed.commitment).toBe(1_000_000)
    expect(JSON.stringify(parsed)).not.toContain('9999999')
  })

  it('rejects an unknown or write tool name', async () => {
    const { executeTool } = buildLpAnalystTools(deps())
    const res = await executeTool({ name: 'record_investment', input: {} })
    expect(JSON.parse(res).error).toBeTruthy()
  })
})
