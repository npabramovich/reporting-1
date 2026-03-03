import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { UsageDashboard } from './usage-dashboard'

export const metadata: Metadata = { title: 'Usage' }

export default async function UsagePage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth')

  const { data: membership } = await supabase
    .from('fund_members')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle() as { data: { role: string } | null }

  if (membership?.role !== 'admin') redirect('/dashboard')

  return <UsageDashboard />
}
