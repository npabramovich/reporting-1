import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveFundFromApiKey, authorizeToolUse } from '@/lib/accounting/api-keys'
import { AGENT_TOOLS, getTool, resolveVehicle } from '@/lib/accounting/agent-tools'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Plain REST agent endpoint (for non-MCP agents / simple HTTP), same tool
// registry as the MCP server. Auth via a fund API key Bearer token.
//   GET  → tool manifest (names, descriptions, input schemas)
//   POST { tool, input } → run one tool

export async function GET(req: NextRequest) {
  const admin = createAdminClient()
  const auth = await resolveFundFromApiKey(admin, req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized — provide a fund API key as a Bearer token' }, { status: 401 })
  return NextResponse.json({
    tools: AGENT_TOOLS.map(t => ({ name: t.name, description: t.description, scope: t.scope, inputSchema: t.inputSchema })),
  })
}

export async function POST(req: NextRequest) {
  const admin = createAdminClient()
  const auth = await resolveFundFromApiKey(admin, req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized — provide a fund API key as a Bearer token' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const tool = getTool(body?.tool)
  if (!tool) return NextResponse.json({ error: `Unknown tool: ${body?.tool}` }, { status: 400 })
  const denied = authorizeToolUse(tool.scope, auth)
  if (denied) return NextResponse.json({ error: denied }, { status: 403 })

  try {
    const input = body?.input ?? {}
    const portfolioGroup = await resolveVehicle(admin, auth.fundId, input.vehicle)
    const result = await tool.handler({ admin, fundId: auth.fundId, portfolioGroup, userId: auth.userId }, input)
    return NextResponse.json({ ok: true, result })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
}
