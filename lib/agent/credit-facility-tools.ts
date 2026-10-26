// Handlers for the CREDIT FACILITY tools (credit-facility-tools-manifest.ts).

import type { AgentToolContext, AgentToolHandler } from '@/lib/accounting/agent-tools'
import { DRAW_PURPOSE_LABEL, EVENT_TYPE_LABEL, FACILITY_KIND_LABEL, facilityStatus } from '@/lib/accounting/credit-facility'
import { lastQuarterEnd } from '@/lib/accounting/fund-performance-format'
import { loadIlpaPerformance } from '@/lib/ilpa/performance-load'

const staged = (name: string): AgentToolHandler => async () => {
  throw new Error(`${name} is always staged for approval; it cannot run directly.`)
}

const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)

export const CREDIT_FACILITY_HANDLERS: Record<string, AgentToolHandler> = {
  credit_facilities: async ({ admin, fundId, portfolioGroup }: AgentToolContext, input: { asOf?: string }) => {
    const s = await facilityStatus(admin, fundId, portfolioGroup, isDate(input?.asOf) ? input.asOf : undefined)
    return {
      ...s,
      facilities: s.facilities.map(f => ({
        ...f,
        kindLabel: FACILITY_KIND_LABEL[f.kind],
        events: f.events.map(e => ({
          ...e,
          typeLabel: EVENT_TYPE_LABEL[e.type],
          ...(e.purpose ? { purposeLabel: DRAW_PURPOSE_LABEL[e.purpose] } : {}),
        })),
      })),
      ...(s.facilities.length ? {} : { note: `${portfolioGroup} has no credit facility on the register. Add one with set_credit_facility.` }),
    }
  },
  ilpa_performance: async ({ admin, fundId, portfolioGroup }: AgentToolContext, input: { asOf?: string }) => {
    const asOf = isDate(input?.asOf) ? input.asOf : lastQuarterEnd(new Date().toISOString().slice(0, 10))
    return loadIlpaPerformance(admin, fundId, portfolioGroup, asOf)
  },
  // Always staged as their pending actions (the manifest's `stagesAs`), so these never run.
  set_credit_facility: staged('set_credit_facility'),
  record_facility_event: staged('record_facility_event'),
  remove_facility_event: staged('remove_facility_event'),
}
