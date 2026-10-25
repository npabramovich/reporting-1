// Handlers for the RECYCLING tools (recycling-tools-manifest.ts).

import type { AgentToolContext, AgentToolHandler } from '@/lib/accounting/agent-tools'
import { recyclingStatus, TREATMENT_LABEL } from '@/lib/accounting/recycling'

const staged = (name: string): AgentToolHandler => async () => {
  throw new Error(`${name} is always staged for approval; it cannot run directly.`)
}

export const RECYCLING_HANDLERS: Record<string, AgentToolHandler> = {
  recycling: async ({ admin, fundId, portfolioGroup }: AgentToolContext) => {
    const s = await recyclingStatus(admin, fundId, portfolioGroup)
    return {
      ...s,
      rows: s.rows.map(r => ({ ...r, treatmentLabel: TREATMENT_LABEL[r.treatment] })),
      ...(s.terms.capRate > 0 ? {} : { note: `${portfolioGroup} has no recycling terms, so nothing can be recycled until they are set (set_recycling_terms).` }),
    }
  },
  // Always staged as their pending actions (the manifest's `stagesAs`), so these never run; they
  // refuse rather than change the partners' capital without a person's approval.
  set_recycling_terms: staged('set_recycling_terms'),
  record_recycling: staged('record_recycling'),
  remove_recycling: staged('remove_recycling'),
}
