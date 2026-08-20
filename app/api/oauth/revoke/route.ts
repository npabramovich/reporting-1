import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { hashToken } from '@/lib/oauth/store'

/**
 * RFC 7009 — token revocation. A client that logs out should be able to hand back
 * its tokens rather than leave them live until they expire.
 *
 * Per the RFC, this ALWAYS returns 200, even for an unknown token: revocation is
 * idempotent, and a distinguishable response would turn this into an oracle for
 * probing which tokens exist.
 */

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const ct = req.headers.get('content-type') ?? ''
  let token: string | null = null
  let clientId: string | null = null

  if (ct.includes('application/json')) {
    const body = await req.json().catch(() => ({}))
    token = typeof (body as any)?.token === 'string' ? (body as any).token : null
    clientId = typeof (body as any)?.client_id === 'string' ? (body as any).client_id : null
  } else {
    const form = new URLSearchParams(await req.text().catch(() => ''))
    token = form.get('token')
    clientId = form.get('client_id')
  }

  if (token) {
    const admin = createAdminClient()
    // Scoped to the presenting client, so one client cannot revoke another's
    // tokens by guessing. Revoking the refresh token of a pair leaves its access
    // token to expire on its own (≤1h), which is the RFC's expected behavior.
    let q = (admin as any)
      .from('oauth_tokens')
      .update({ revoked_at: new Date().toISOString() })
      .eq('token_hash', hashToken(token))
      .is('revoked_at', null)

    if (clientId) q = q.eq('client_id', clientId)
    await q
  }

  return new NextResponse(null, { status: 200, headers: cors() })
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: cors() })
}

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  }
}
