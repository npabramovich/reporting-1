// Handlers for the ILPA tools (ilpa-tools-manifest.ts).

import type { AgentToolContext, AgentToolHandler } from '@/lib/accounting/agent-tools'
import { loadCcdNotices } from '@/lib/lp-templates/ccd-load'
import { loadIlpaReporting } from '@/lib/lp-templates/reporting-load'
import { lastQuarterEnd } from '@/lib/accounting/fund-performance'

export const ILPA_HANDLERS: Record<string, AgentToolHandler> = {
  ilpa_notice_data: async ({ admin, fundId, portfolioGroup }: AgentToolContext, input: { kind?: string; id?: string; lpEntityId?: string }) => {
    if (input?.kind !== 'capital_call' && input?.kind !== 'distribution') throw new Error('kind must be capital_call or distribution.')
    if (typeof input.id !== 'string' || !input.id) throw new Error('Which call or distribution? Pass its id.')
    const out = await loadCcdNotices(admin, fundId, portfolioGroup, input.kind, input.id, input.lpEntityId || null)
    if (!out.ok) throw new Error(out.error)
    return { vehicle: portfolioGroup, notices: out.notices }
  },

  ilpa_reporting_template: async ({ admin, fundId, portfolioGroup }: AgentToolContext, input: { lpEntityId?: string; quarterEnd?: string }) => {
    if (typeof input?.lpEntityId !== 'string' || !input.lpEntityId) throw new Error('Which partner? Pass its lpEntityId.')
    const quarterEnd = input.quarterEnd || lastQuarterEnd(new Date().toISOString().slice(0, 10))
    const out = await loadIlpaReporting(admin, fundId, portfolioGroup, input.lpEntityId, quarterEnd)
    if ('error' in out) throw new Error(out.error)
    return out
  },
}
