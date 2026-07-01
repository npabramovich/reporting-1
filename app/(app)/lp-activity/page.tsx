import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { DEFAULT_FEATURE_VISIBILITY, isFeatureVisible } from '@/lib/types/features'
import type { FeatureVisibilityMap } from '@/lib/types/features'
import { LpActivityDashboard } from './lp-activity-dashboard'

export const metadata: Metadata = { title: 'LP Activity' }

export default async function LpActivityPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth')

  const admin = createAdminClient()
  const { data: membership } = await admin
    .from('fund_members')
    .select('fund_id, role')
    .eq('user_id', user.id)
    .maybeSingle() as { data: { fund_id: string; role: string } | null }
  if (!membership) redirect('/dashboard')

  const { data: fundSettings } = await (admin as any)
    .from('fund_settings')
    .select('feature_visibility')
    .eq('fund_id', membership.fund_id)
    .maybeSingle()
  const featureVisibility: FeatureVisibilityMap = {
    ...DEFAULT_FEATURE_VISIBILITY,
    ...(fundSettings?.feature_visibility ?? {}),
  }
  if (!isFeatureVisible(featureVisibility, 'lp_activity', membership.role === 'admin')) {
    redirect('/dashboard')
  }

  return <LpActivityDashboard />
}
