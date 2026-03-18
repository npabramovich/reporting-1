import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logActivity } from '@/lib/activity'

// Handles magic link, password reset, and OAuth redirects from Supabase Auth.
// Supabase appends ?code= to the redirect URL after authentication.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const token_hash = searchParams.get('token_hash')
  const type = searchParams.get('type') as 'invite' | 'magiclink' | 'recovery' | 'email' | 'email_change' | null
  let next = searchParams.get('next') ?? '/'

  // Prevent open redirect — only allow relative paths
  if (!next.startsWith('/') || next.startsWith('//')) {
    next = '/'
  }

  let authError: Error | null = null;
  const supabase = createClient()

  if (token_hash && type) {
    // Handle token_hash + type for PKCE cross-browser issues
    const { error } = await supabase.auth.verifyOtp({ token_hash, type })
    authError = error
  } else if (code) {
    // Handle code (standard flow)
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    authError = error
  } else {
    // Neither code nor token_hash/type are present
    return NextResponse.redirect(`${origin}/auth?error=${encodeURIComponent('Invalid or expired link. Please try again.')}`)
  }

  if (!authError) {
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
      } else if (next === '/') {
        // New user with no fund — send to onboarding with confirmation message
        return NextResponse.redirect(`${origin}/onboarding?confirmed=true`)
      }
    }
    return NextResponse.redirect(`${origin}${next}`)
  }

  return NextResponse.redirect(`${origin}/auth?error=${encodeURIComponent(authError.message)}`)
}
