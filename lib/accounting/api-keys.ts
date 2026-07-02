// Fund API-key generation and verification for agent access. Only the SHA-256
// hash is stored; the plaintext token (shown once) is what an agent presents as
// a Bearer token to the ledger API / MCP endpoint.

import crypto from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

const PREFIX = 'lk_' // "ledger key"

export interface GeneratedKey {
  token: string   // full plaintext, shown once
  prefix: string  // stored for display
  hash: string    // stored (sha256 hex)
}

/** Mint a new key: 32 random bytes, base64url. Returns token + what to store. */
export function generateApiKey(): GeneratedKey {
  const token = PREFIX + crypto.randomBytes(32).toString('base64url')
  return { token, prefix: token.slice(0, 11), hash: hashApiKey(token) }
}

export function hashApiKey(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

/** Extract a Bearer token from a request's Authorization header (or null). */
export function bearerToken(req: Request): string | null {
  const auth = req.headers.get('authorization') ?? req.headers.get('Authorization')
  if (!auth) return null
  const m = auth.match(/^Bearer\s+(.+)$/i)
  return m ? m[1].trim() : null
}

export interface ResolvedKey {
  fundId: string
  keyId: string
  scopes: string[]
}

/**
 * Resolve a fund from a Bearer API key. Verifies the hash against a non-revoked
 * key, stamps last_used_at, and returns the fund + scopes — or null if invalid.
 */
export async function resolveFundFromApiKey(admin: SupabaseClient, req: Request): Promise<ResolvedKey | null> {
  const token = bearerToken(req)
  if (!token) return null
  const hash = hashApiKey(token)

  const { data } = await admin
    .from('fund_api_keys' as any)
    .select('id, fund_id, scopes, revoked_at')
    .eq('key_hash', hash)
    .maybeSingle()

  const row = data as any
  if (!row || row.revoked_at) return null

  // Best-effort usage stamp; ignore failures.
  await admin.from('fund_api_keys' as any).update({ last_used_at: new Date().toISOString() }).eq('id', row.id)

  return { fundId: row.fund_id, keyId: row.id, scopes: String(row.scopes ?? 'read').split(',').map(s => s.trim()) }
}
