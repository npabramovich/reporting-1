import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertAdminAccess } from '@/lib/api-helpers'
import { resolveGroupOr400 } from '@/lib/accounting/http-vehicle'
import { listPeriods } from '@/lib/accounting/periods'
import { previewClose, closePeriodWithAllocation, reopenPeriodWithReversal } from '@/lib/accounting/close'

// GET — list a vehicle's fiscal periods.
export async function GET(req: NextRequest) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertAdminAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate
  const group = await resolveGroupOr400(admin, gate.fundId, req.nextUrl.searchParams.get('group'))
  if (group instanceof NextResponse) return group
  return NextResponse.json(await listPeriods(admin, gate.fundId, group))
}

// POST
//   { action: 'preview', periodStart, periodEnd }        → what closing would allocate
//   { action: 'close',   periodStart, periodEnd, label } → allocate, snapshot, lock
//   { action: 'reopen',  id }                            → void the allocation, unlock
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

  if (body?.action === 'preview') {
    const result = await previewClose(admin, gate.fundId, group, body?.periodStart, body?.periodEnd)
    if ('error' in result) return NextResponse.json({ error: result.error }, { status: 400 })
    return NextResponse.json(result)
  }

  if (body?.action === 'reopen') {
    if (!body?.id) return NextResponse.json({ error: 'id is required' }, { status: 400 })
    const result = await reopenPeriodWithReversal(admin, gate.fundId, group, body.id)
    if ('error' in result) return NextResponse.json({ error: result.error }, { status: 400 })
    return NextResponse.json(result)
  }

  const result = await closePeriodWithAllocation(
    admin, gate.fundId, group, user.id, body?.periodStart, body?.periodEnd, body?.label
  )
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 400 })
  return NextResponse.json({ ok: true, ...result })
}
