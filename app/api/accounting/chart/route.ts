import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertAdminAccess } from '@/lib/api-helpers'
import { resolveGroupOr400 } from '@/lib/accounting/http-vehicle'
import { dbError } from '@/lib/api-error'
import { DEFAULT_CHART } from '@/lib/accounting/chart'

// GET — list the vehicle's chart of accounts.
export async function GET(req: NextRequest) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertAdminAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate
  const group = await resolveGroupOr400(admin, gate.fundId, req.nextUrl.searchParams.get('group'))
  if (group instanceof NextResponse) return group

  const { data, error } = await admin
    .from('chart_of_accounts' as any)
    .select('*')
    .eq('fund_id', gate.fundId)
    .eq('portfolio_group', group)
    .order('code', { ascending: true })
  if (error) return dbError(error, 'accounting-chart')
  return NextResponse.json(data ?? [])
}

// POST — seed the default chart for the vehicle (no-op if any account exists).
export async function POST(req: NextRequest) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertAdminAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate
  const body = await req.json().catch(() => ({}))
  const group = await resolveGroupOr400(admin, gate.fundId, body?.group ?? req.nextUrl.searchParams.get('group'))
  if (group instanceof NextResponse) return group

  const { count } = await admin
    .from('chart_of_accounts' as any)
    .select('id', { count: 'exact', head: true })
    .eq('fund_id', gate.fundId)
    .eq('portfolio_group', group)
  if ((count ?? 0) > 0) return NextResponse.json({ seeded: 0, message: 'Chart already exists' })

  const rows = DEFAULT_CHART.map(a => ({ fund_id: gate.fundId, portfolio_group: group, code: a.code, name: a.name, type: a.type, subtype: a.subtype ?? null }))
  const { data, error } = await admin.from('chart_of_accounts' as any).insert(rows).select('*')
  if (error) return dbError(error, 'accounting-chart-seed')
  return NextResponse.json({ seeded: (data as any[])?.length ?? 0, accounts: data ?? [] })
}
