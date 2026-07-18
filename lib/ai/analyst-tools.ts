import type { SupabaseClient } from '@supabase/supabase-js'
import {
  AGENT_TOOLS,
  getTool,
  accessDomainFor,
  accessDomainForCall,
  accessFeatureFor,
  resolveVehicleForTool,
} from '@/lib/accounting/agent-tools'
import { hasAccess, type AccessContext } from '@/lib/access/effective'
import type { ToolDefinition, ToolExecutor, ToolInvocation } from '@/lib/ai/types'

export interface AnalystToolDeps {
  admin: SupabaseClient
  fundId: string
  userId: string | null
  access: AccessContext
  vehicle?: string
}

/**
 * Turns the access-filtered agent-tool registry into `{ tools, executeTool }` for a provider's
 * `createToolLoop`. Phase A exposes READ tools only; each is gated by `hasAccess(read)` on the
 * tool's access domain, and every execution re-checks access against the call's resolved domain
 * (some tools' domain depends on their input). Scope from the request narrows what appears; it
 * never widens the caller's access.
 */
export function buildAnalystTools(deps: AnalystToolDeps): { tools: ToolDefinition[]; executeTool: ToolExecutor } {
  const available = AGENT_TOOLS.filter(
    t => t.scope === 'read' && hasAccess(deps.access, accessDomainFor(t), 'read', accessFeatureFor(t)),
  )
  const tools: ToolDefinition[] = available.map(t => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  }))

  const executeTool: ToolExecutor = async (call: ToolInvocation) => {
    const tool = getTool(call.name)
    if (!tool || tool.scope !== 'read') {
      return JSON.stringify({ error: `Unknown or non-readable tool: ${call.name}` })
    }
    if (!hasAccess(deps.access, accessDomainForCall(tool, call.input), 'read', accessFeatureFor(tool))) {
      return JSON.stringify({ error: 'Access denied' })
    }
    try {
      const vehicle = (call.input as { vehicle?: string })?.vehicle ?? deps.vehicle
      const portfolioGroup = await resolveVehicleForTool(tool, deps.admin, deps.fundId, vehicle)
      const result = await tool.handler(
        { admin: deps.admin, fundId: deps.fundId, portfolioGroup, userId: deps.userId, access: deps.access },
        call.input,
      )
      return JSON.stringify(result)
    } catch (e) {
      return JSON.stringify({ error: (e as Error).message })
    }
  }

  return { tools, executeTool }
}
