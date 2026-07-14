import { NextRequest, NextResponse } from 'next/server'
import { authorizationServerMetadata } from '@/lib/oauth/metadata'

/**
 * RFC 8414 Authorization Server Metadata.
 *
 * Served at /.well-known/oauth-authorization-server via a rewrite in
 * next.config.js — Next's app router won't route a literal `.well-known`
 * directory, so the well-known path is rewritten onto this route.
 *
 * Public and unauthenticated by design: this document is pure capability
 * advertisement and contains no secrets.
 */

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  return NextResponse.json(authorizationServerMetadata(req), {
    headers: {
      // Discovery is hit on every fresh connect; a short cache is fine, but it
      // must not be cached across deployments to a different origin.
      'Cache-Control': 'public, max-age=300',
      'Access-Control-Allow-Origin': '*',
    },
  })
}

/** Claude fetches discovery from a browser context, so CORS preflight must pass. */
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, MCP-Protocol-Version',
    },
  })
}
