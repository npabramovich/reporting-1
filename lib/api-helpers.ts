import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Returns the user's fund membership, or a 403 response if the user
 * has a read-only (viewer) role and cannot perform mutations.
 */
export async function assertWriteAccess(
  admin: SupabaseClient,
  userId: string
): Promise<{ fundId: string; role: string } | NextResponse> {
  const { data: membership, error } = await admin
    .from('fund_members')
    .select('fund_id, role')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) {
    console.error('[assertWriteAccess] DB error:', error.message)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }

  if (!membership)
    return NextResponse.json({ error: 'No fund found' }, { status: 403 })

  if (membership.role === 'viewer')
    return NextResponse.json(
      { error: 'This is a read-only demo. Changes are not allowed.' },
      { status: 403 }
    )

  return { fundId: membership.fund_id, role: membership.role }
}

/**
 * LP-side mirror of {@link assertWriteAccess}, for /portal API routes.
 *
 * Resolves the caller's active LP account and the set of lp_investor_ids they
 * may see — direct links plus links delegated to them as an authorized user —
 * or a 403 if they have no active LP access. NEVER consults `fund_members`; the
 * GP and LP access graphs are kept strictly separate so a GP membership can
 * never widen LP visibility (and vice-versa). Portal routes must scope every
 * query to the returned `investorIds`.
 */
export async function resolveLpAccess(
  admin: SupabaseClient,
  userId: string
): Promise<{ lpAccountId: string; investorIds: string[] } | NextResponse> {
  const { data: account, error } = await admin
    .from('lp_accounts')
    .select('id, status')
    .eq('auth_user_id', userId)
    .maybeSingle()

  if (error) {
    console.error('[resolveLpAccess] DB error:', error.message)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
  if (!account || account.status !== 'active') {
    return NextResponse.json({ error: 'No LP access' }, { status: 403 })
  }

  const [{ data: links }, { data: delegated }] = await Promise.all([
    admin.from('lp_account_links').select('lp_investor_id').eq('lp_account_id', account.id),
    admin.from('lp_authorized_users').select('lp_investor_id').eq('authorized_user_account_id', account.id),
  ])

  const investorIds = Array.from(new Set([
    ...((links ?? []) as { lp_investor_id: string }[]).map(l => l.lp_investor_id),
    ...((delegated ?? []) as { lp_investor_id: string }[]).map(d => d.lp_investor_id),
  ]))

  return { lpAccountId: account.id as string, investorIds }
}
