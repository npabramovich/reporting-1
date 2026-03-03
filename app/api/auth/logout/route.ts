import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logActivity } from '@/lib/activity'

export async function POST() {
  const supabase = createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (user) {
    const admin = createAdminClient()
    const { data: membership } = await admin
      .from('fund_members')
      .select('fund_id')
      .eq('user_id', user.id)
      .maybeSingle()
    if (membership) {
      logActivity(admin, membership.fund_id, user.id, 'logout')
    }
  }

  await supabase.auth.signOut()
  return NextResponse.redirect(
    new URL('/auth', process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000')
  )
}
