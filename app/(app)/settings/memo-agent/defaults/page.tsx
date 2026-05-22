import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { DefaultsEditor } from './editor'

export const metadata: Metadata = { title: 'Diligence Defaults' }

export default async function DefaultsPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth')

  const admin = createAdminClient()
  const { data: membership } = await admin
    .from('fund_members')
    .select('fund_id')
    .eq('user_id', user.id)
    .maybeSingle()
  // Diligence settings are open to any fund member, not admin-only.
  if (!membership) redirect('/dashboard')

  return <DefaultsEditor />
}
