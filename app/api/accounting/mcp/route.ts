import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveFundFromApiKey, authorizeToolUse, type ResolvedKey } from '@/lib/accounting/api-keys'
import { AGENT_TOOLS, getTool, type AgentToolContext } from '@/lib/accounting/agent-tools'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Minimal MCP server over Streamable HTTP (stateless JSON mode). Exposes the
// ledger tool registry so any MCP client / agent can drive the books with a
// fund API key as the Bearer token. Implements initialize, tools/list, tools/call.

const PROTOCOL_VERSION = '2024-11-05'
const SERVER_INFO = { name: 'reporting-ledger', version: '0.1.0' }

interface RpcRequest { jsonrpc: string; id?: string | number | null; method: string; params?: any }

function ok(id: any, result: any) {
  return { jsonrpc: '2.0', id, result }
}
function err(id: any, code: number, message: string) {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

async function handle(rpc: RpcRequest, ctx: AgentToolContext, auth: ResolvedKey): Promise<any | null> {
  switch (rpc.method) {
    case 'initialize':
      return ok(rpc.id, { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: SERVER_INFO })
    case 'ping':
      return ok(rpc.id, {})
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return null // notification — no response
    case 'tools/list':
      return ok(rpc.id, { tools: AGENT_TOOLS.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) })
    case 'tools/call': {
      const name = rpc.params?.name
      const tool = getTool(name)
      if (!tool) return err(rpc.id, -32602, `Unknown tool: ${name}`)
      const denied = authorizeToolUse(tool.scope, auth)
      if (denied) return ok(rpc.id, { content: [{ type: 'text', text: denied }], isError: true })
      try {
        const result = await tool.handler(ctx, rpc.params?.arguments ?? {})
        return ok(rpc.id, { content: [{ type: 'text', text: JSON.stringify(result) }] })
      } catch (e) {
        return ok(rpc.id, { content: [{ type: 'text', text: (e as Error).message }], isError: true })
      }
    }
    default:
      return err(rpc.id, -32601, `Method not found: ${rpc.method}`)
  }
}

export async function POST(req: NextRequest) {
  const admin = createAdminClient()
  const auth = await resolveFundFromApiKey(admin, req)
  if (!auth) return NextResponse.json(err(null, -32001, 'Unauthorized — provide a valid fund API key as a Bearer token'), { status: 401 })

  const ctx: AgentToolContext = { admin, fundId: auth.fundId, userId: auth.userId }
  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json(err(null, -32700, 'Parse error'), { status: 400 })

  // Support JSON-RPC batches.
  if (Array.isArray(body)) {
    const responses = (await Promise.all(body.map(r => handle(r, ctx, auth)))).filter(Boolean)
    return responses.length ? NextResponse.json(responses) : new NextResponse(null, { status: 202 })
  }

  const response = await handle(body, ctx, auth)
  if (response === null) return new NextResponse(null, { status: 202 })
  return NextResponse.json(response)
}

export async function GET() {
  // Streamable-HTTP SSE stream is not implemented; this server is stateless JSON.
  return NextResponse.json({ error: 'Use POST with JSON-RPC. This MCP server runs in stateless JSON mode.' }, { status: 405 })
}
