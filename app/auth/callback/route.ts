import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logActivity } from '@/lib/activity'

// Handles magic link, password reset, and OAuth redirects from Supabase Auth.
// Supabase appends ?code= to the redirect URL after authentication.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  let next = searchParams.get('next') ?? '/'

  // Prevent open redirect — only allow relative paths
  if (!next.startsWith('/') || next.startsWith('//')) {
    next = '/'
  }

  if (!code) {
    return NextResponse.redirect(`${origin}/auth?error=${encodeURIComponent('Invalid or expired link. Please try again.')}`)
  }

  const supabase = createClient()
  const { error } = await supabase.auth.exchangeCodeForSession(code)
  if (!error) {
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      const admin = createAdminClient()
      const { data: membership } = await admin
        .from('fund_members')
        .select('fund_id')
        .eq('user_id', user.id)
        .maybeSingle()
      if (membership) {
        logActivity(admin, membership.fund_id, user.id, 'login', { method: 'magic_link' })
      }
    }
    return NextResponse.redirect(`${origin}${next}`)
  }

  return NextResponse.redirect(`${origin}/auth?error=${encodeURIComponent(error.message)}`)
}
