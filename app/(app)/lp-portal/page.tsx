import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { DEFAULT_FEATURE_VISIBILITY, isFeatureVisible } from '@/lib/types/features'
import type { FeatureVisibilityMap } from '@/lib/types/features'
import { LpPortalDashboard } from './lp-portal-dashboard'

export const metadata: Metadata = { title: 'LP Documents' }

export default async function LpPortalPage() {
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

  const { data: fs } = await (admin as any)
    .from('fund_settings')
    .select('lp_portal_enabled, feature_visibility')
    .eq('fund_id', membership.fund_id)
    .maybeSingle()

  // Master switch off → page unavailable to everyone.
  if (!fs?.lp_portal_enabled) redirect('/dashboard')

  const fv: FeatureVisibilityMap = { ...DEFAULT_FEATURE_VISIBILITY, ...(fs?.feature_visibility ?? {}) }
  if (!isFeatureVisible(fv, 'lp_portal', membership.role === 'admin')) redirect('/dashboard')

  return <LpPortalDashboard />
}
