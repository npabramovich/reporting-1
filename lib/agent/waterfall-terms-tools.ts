// Handlers for the WATERFALL TERMS tools (waterfall-terms-tools-manifest.ts).

import type { AgentToolContext, AgentToolHandler } from '@/lib/accounting/agent-tools'
import { loadCarryTerms } from '@/lib/accounting/carry'
import { extractLpaTerms } from '@/lib/accounting/lpa-terms-run'

export const WATERFALL_TERMS_HANDLERS: Record<string, AgentToolHandler> = {
  waterfall_terms: async ({ admin, fundId, portfolioGroup }: AgentToolContext) => {
    const terms = await loadCarryTerms(admin, fundId, portfolioGroup)
    const { data } = await admin.from('lp_entities' as any).select('id, entity_name, partner_class').eq('fund_id', fundId)
    const entities = ((data as any[]) ?? []) as { id: string; entity_name: string; partner_class: string | null }[]
    const nameOf = new Map(entities.map(e => [e.id, e.entity_name]))
    return {
      vehicle: portfolioGroup,
      terms,
      recipients: terms.recipients.map(r => ({ ...r, name: nameOf.get(r.lpEntityId) ?? r.lpEntityId })),
      // Who could receive it: normally the GP entity, but any partner of the fund may.
      gpClassPartners: entities.filter(e => e.partner_class === 'gp').map(e => ({ lpEntityId: e.id, name: e.entity_name })),
      spec: 'docs/spec/waterfall-terms.md',
    }
  },

  extract_lpa_terms: async ({ admin, fundId, portfolioGroup, userId }: AgentToolContext, input: any) =>
    extractLpaTerms(admin, { fundId, group: portfolioGroup, userId }, input ?? {}),

  // Always staged as the set_waterfall_terms pending action (its manifest's `stagesAs`), so this
  // never runs; it refuses rather than change the partners' carry without a person's approval.
  set_waterfall_terms: async () => {
    throw new Error('set_waterfall_terms is always staged for approval; it cannot run directly.')
  },
}
