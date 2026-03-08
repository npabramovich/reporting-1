import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertWriteAccess } from '@/lib/api-helpers'
import { dbError } from '@/lib/api-error'

// ---------------------------------------------------------------------------
// GET — get all fund group configs for this fund
// ---------------------------------------------------------------------------

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

  if (!membership) return NextResponse.json({ error: 'No fund found' }, { status: 403 })

  const { data, error } = await admin
    .from('fund_group_config' as any)
    .select('*')
    .eq('fund_id', membership.fund_id) as { data: any[] | null; error: { message: string } | null }

  if (error) return dbError(error, 'fund-group-config')

  return NextResponse.json(data ?? [])
}

// ---------------------------------------------------------------------------
// PUT — upsert group config (cash_on_hand, carry_rate, gp_commit_pct)
// ---------------------------------------------------------------------------

export async function PUT(req: NextRequest) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const writeCheck = await assertWriteAccess(admin, user.id)
  if (writeCheck instanceof NextResponse) return writeCheck

  const { data: membership } = await admin
    .from('fund_members')
    .select('fund_id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!membership) return NextResponse.json({ error: 'No fund found' }, { status: 403 })

  const body = await req.json()
  const { portfolioGroup, cashOnHand, carryRate, gpCommitPct } = body

  if (!portfolioGroup) {
    return NextResponse.json({ error: 'portfolioGroup is required' }, { status: 400 })
  }

  const row: Record<string, any> = {
    fund_id: membership.fund_id,
    portfolio_group: portfolioGroup,
    updated_at: new Date().toISOString(),
  }
  if (cashOnHand !== undefined) row.cash_on_hand = parseFloat(cashOnHand ?? 0)
  if (carryRate !== undefined) row.carry_rate = parseFloat(carryRate ?? 0.2)
  if (gpCommitPct !== undefined) row.gp_commit_pct = parseFloat(gpCommitPct ?? 0)

  const { data, error } = await admin
    .from('fund_group_config' as any)
    .upsert(row, { onConflict: 'fund_id,portfolio_group' })
    .select('*')
    .single() as { data: any; error: { message: string } | null }

  if (error) return dbError(error, 'fund-group-config-upsert')

  return NextResponse.json(data)
}
