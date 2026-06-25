import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Bind + activate the signed-in user's LP account (called at the end of portal
 * onboarding, after they've verified their code and set a password).
 *
 * Finds the lp_account by auth_user_id, falling back to a case-insensitive
 * email match (the invite may not have pre-bound the auth user), then sets
 * auth_user_id + status = 'active'. Idempotent.
 */
export async function POST() {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let { data: account } = await (admin as any)
    .from('lp_accounts')
    .select('id, status, auth_user_id')
    .eq('auth_user_id', user.id)
    .maybeSingle()

  if (!account && user.email) {
    const { data: byEmail } = await (admin as any)
      .from('lp_accounts')
      .select('id, status, auth_user_id')
      .eq('email', user.email.toLowerCase())
      .maybeSingle()
    account = byEmail
  }

  if (!account) {
    return NextResponse.json({ error: 'No LP invitation is associated with this account.' }, { status: 403 })
  }

  // Guard: don't hijack an account already bound to a different auth user.
  if (account.auth_user_id && account.auth_user_id !== user.id) {
    return NextResponse.json({ error: 'This invitation is linked to a different account.' }, { status: 409 })
  }

  const { error } = await (admin as any)
    .from('lp_accounts')
    .update({ auth_user_id: user.id, status: 'active', updated_at: new Date().toISOString() })
    .eq('id', account.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
