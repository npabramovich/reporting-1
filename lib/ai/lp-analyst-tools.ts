import type { SupabaseClient } from '@supabase/supabase-js'
import type { ToolDefinition, ToolExecutor, ToolInvocation } from '@/lib/ai/types'
import { computeRow, computeTotals, type InvestmentRow } from '@/lib/lp-report-pdf'

/**
 * Read-only tools for the LP-portal analyst, HARD-SCOPED to the caller's `investorIds`. Unlike the
 * GP analyst these are NOT the fund-wide registry — that registry is not investor-scoped. Every
 * query is closed over `investorIds`; no tool ever reads an investor id from its input, so a
 * caller cannot ask about another LP's position by passing an id.
 */
export interface LpAnalystToolDeps {
  admin: SupabaseClient
  fundId: string
  investorIds: string[]
}

const EMPTY_SCHEMA = { type: 'object', properties: {} } as const

/** The snapshots shared with these investors (deduped). */
async function sharedSnapshots(deps: LpAnalystToolDeps): Promise<Array<{ id: string; name: string; as_of_date: string | null }>> {
  const { data } = await deps.admin
    .from('lp_snapshot_shares')
    .select('lp_snapshots(id, name, as_of_date)')
    .eq('fund_id', deps.fundId)
    .in('lp_investor_id', deps.investorIds)
  const map = new Map<string, { id: string; name: string; as_of_date: string | null }>()
  for (const s of (data ?? []) as unknown as Array<{ lp_snapshots: { id: string; name: string; as_of_date: string | null } | null }>) {
    if (s.lp_snapshots) map.set(s.lp_snapshots.id, s.lp_snapshots)
  }
  return Array.from(map.values())
}

/** This investor's computed rows for one snapshot — filtered by the closed-over investorIds. */
async function investorRows(deps: LpAnalystToolDeps, snapshotId: string) {
  const investorSet = new Set(deps.investorIds)
  const { data: invs } = await deps.admin
    .from('lp_investments')
    .select(
      'id, entity_id, portfolio_group, commitment, total_value, nav, called_capital, paid_in_capital, distributions, irr, lp_entities(id, entity_name, investor_id, lp_investors(id, name))',
    )
    .eq('snapshot_id', snapshotId)
  return ((invs ?? []) as unknown as InvestmentRow[])
    .filter(inv => investorSet.has(inv.lp_entities?.lp_investors?.id))
    .map(computeRow)
}

/** The latest shared snapshot by as_of_date (falls back to the first if none dated). */
function latestSnapshot(snaps: Array<{ id: string; name: string; as_of_date: string | null }>) {
  if (!snaps.length) return null
  return [...snaps].sort((a, b) => String(b.as_of_date ?? '').localeCompare(String(a.as_of_date ?? '')))[0]
}

export function buildLpAnalystTools(deps: LpAnalystToolDeps): { tools: ToolDefinition[]; executeTool: ToolExecutor } {
  const tools: ToolDefinition[] = [
    {
      name: 'list_statements',
      description: 'List the capital-account statements (snapshots) shared with you.',
      inputSchema: EMPTY_SCHEMA,
    },
    {
      name: 'get_capital_account',
      description: 'Your current capital-account figures (commitment, paid-in, distributions, NAV, total value) from the latest shared statement.',
      inputSchema: EMPTY_SCHEMA,
    },
    {
      name: 'get_performance',
      description: 'Your performance multiples (TVPI, DPI, RVPI) and IRR from the latest shared statement.',
      inputSchema: EMPTY_SCHEMA,
    },
  ]

  const executeTool: ToolExecutor = async (call: ToolInvocation) => {
    try {
      if (call.name === 'list_statements') {
        const snaps = await sharedSnapshots(deps)
        return JSON.stringify(snaps.map(s => ({ id: s.id, name: s.name, as_of_date: s.as_of_date })))
      }

      if (call.name === 'get_capital_account') {
        const snap = latestSnapshot(await sharedSnapshots(deps))
        if (!snap) return JSON.stringify({ error: 'No statement has been shared with you yet.' })
        const rows = await investorRows(deps, snap.id)
        const totals = computeTotals(rows)
        return JSON.stringify({
          statement: snap.name,
          as_of_date: snap.as_of_date,
          commitment: totals.commitment,
          paidInCapital: totals.paidInCapital,
          distributions: totals.distributions,
          nav: totals.nav,
          totalValue: totals.totalValue,
        })
      }

      if (call.name === 'get_performance') {
        const snap = latestSnapshot(await sharedSnapshots(deps))
        if (!snap) return JSON.stringify({ error: 'No statement has been shared with you yet.' })
        const rows = await investorRows(deps, snap.id)
        const totals = computeTotals(rows)
        // IRR isn't additive; surface the single row's IRR when there's exactly one position.
        const irr = rows.length === 1 ? rows[0].irr : null
        return JSON.stringify({
          statement: snap.name,
          as_of_date: snap.as_of_date,
          tvpi: totals.tvpi,
          dpi: totals.dpi,
          rvpi: totals.rvpi,
          irr,
        })
      }

      return JSON.stringify({ error: `Unknown tool: ${call.name}` })
    } catch (e) {
      return JSON.stringify({ error: (e as Error).message })
    }
  }

  return { tools, executeTool }
}
