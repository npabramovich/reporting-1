import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// Root route: check auth, membership, and onboarding state, redirect accordingly.
export default async function Home() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/auth')

  const admin = createAdminClient()

  // Check if user is a member of any fund
  const { data: membership } = await admin
    .from('fund_members')
    .select('fund_id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (membership) {
    // Fund exists — check if basic setup is done (fund_settings row exists)
    const { data: settings } = await admin
      .from('fund_settings')
      .select('id')
      .eq('fund_id', membership.fund_id)
      .maybeSingle()

    if (settings) {
      redirect('/dashboard')
    }

    // No settings row yet — finish onboarding
    redirect('/onboarding')
  }

  // Check for pending join requests
  const { data: pendingRequest } = await admin
    .from('fund_join_requests')
    .select('id')
    .eq('user_id', user.id)
    .eq('status', 'pending')
    .limit(1)
    .maybeSingle()

  if (pendingRequest) redirect('/pending')

  redirect('/onboarding')
}
