import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: membership } = await admin
    .from('fund_members')
    .select('fund_id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!membership) return NextResponse.json({ error: 'No fund' }, { status: 403 })

  const [itemsRes, profileRes, settingsRes, deadlinesRes] = await Promise.all([
    admin.from('compliance_items').select('*').order('sort_order'),
    admin.from('fund_compliance_profile').select('*').eq('fund_id', membership.fund_id).maybeSingle(),
    admin.from('compliance_fund_settings').select('*').eq('fund_id', membership.fund_id),
    admin.from('compliance_deadlines').select('*').eq('fund_id', membership.fund_id).order('due_date'),
  ])

  return NextResponse.json({
    items: itemsRes.data ?? [],
    profile: profileRes.data ?? null,
    settings: settingsRes.data ?? [],
    deadlines: deadlinesRes.data ?? [],
  })
}
