import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertAdminAccess } from '@/lib/api-helpers'
import { dbError } from '@/lib/api-error'
import { generateApiKey } from '@/lib/accounting/api-keys'

export const runtime = 'nodejs'

// GET — list the fund's API keys (never returns the hash or the token).
export async function GET() {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertAdminAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate

  const { data, error } = await admin
    .from('fund_api_keys' as any)
    .select('id, name, key_prefix, scopes, last_used_at, revoked_at, created_at')
    .eq('fund_id', gate.fundId)
    .order('created_at', { ascending: false })
  if (error) return dbError(error, 'accounting-keys')
  return NextResponse.json(data ?? [])
}

// POST — mint a new key. The plaintext token is returned ONCE.
export async function POST(req: NextRequest) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertAdminAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate

  const body = await req.json().catch(() => ({}))
  const name = (body?.name ?? '').toString().trim()
  if (!name) return NextResponse.json({ error: 'A key name is required' }, { status: 400 })
  const scopes = body?.readOnly ? 'read' : 'read,write'

  const key = generateApiKey()
  const { data, error } = await admin
    .from('fund_api_keys' as any)
    .insert({ fund_id: gate.fundId, name, key_prefix: key.prefix, key_hash: key.hash, scopes, created_by: user.id })
    .select('id, name, key_prefix, scopes, created_at')
    .single()
  if (error) return dbError(error, 'accounting-keys-create')

  // The token is shown once and never stored in plaintext.
  return NextResponse.json({ token: key.token, key: data })
}

// DELETE ?id= — revoke a key.
export async function DELETE(req: NextRequest) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertAdminAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const { error } = await admin
    .from('fund_api_keys' as any)
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id)
    .eq('fund_id', gate.fundId)
  if (error) return dbError(error, 'accounting-keys-revoke')
  return NextResponse.json({ ok: true })
}
