// Fees the GP earns from portfolio companies, which the fee schedule's offsets credit against the
// management fee (lib/accounting/portfolio-fees.ts).
//
//   GET    ?group=X                       the vehicle's fees, oldest first
//   POST   ?group=X  { date, kind, amount, companyId?, memo? }   record one
//   DELETE ?group=X&id=ID                 remove one

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
// accounting domain (see lib/access/route-domains.ts), the same as the fee schedule they offset.
import { assertWriteAccess, assertReadAccess } from '@/lib/api-helpers'
import { resolveGroupOr400 } from '@/lib/accounting/http-vehicle'
import { addPortfolioFee, deletePortfolioFee, loadPortfolioFees } from '@/lib/accounting/portfolio-fees'
import { dbError } from '@/lib/api-error'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertReadAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate
  const group = await resolveGroupOr400(admin, gate, req.nextUrl.searchParams.get('group'))
  if (group instanceof NextResponse) return group

  const fees = await loadPortfolioFees(admin, gate.fundId, group)
  if ('error' in fees) return NextResponse.json({ error: fees.error }, { status: 500 })
  return NextResponse.json({ group, fees })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertWriteAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate

  const body = await req.json().catch(() => ({}))
  const group = await resolveGroupOr400(admin, gate, body?.group ?? req.nextUrl.searchParams.get('group'))
  if (group instanceof NextResponse) return group

  const saved = await addPortfolioFee(admin, gate.fundId, group, body, user.id)
  if ('error' in saved) {
    if (saved.dbError) return dbError(saved.dbError, 'portfolio-fees-post')
    return NextResponse.json({ error: saved.error }, { status: saved.status })
  }
  return NextResponse.json({ ok: true, fee: saved.fee })
}

export async function DELETE(req: NextRequest) {
  const supabase = await createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertWriteAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate
  const group = await resolveGroupOr400(admin, gate, req.nextUrl.searchParams.get('group'))
  if (group instanceof NextResponse) return group

  const removed = await deletePortfolioFee(admin, gate.fundId, group, req.nextUrl.searchParams.get('id') ?? '')
  if ('error' in removed) {
    if (removed.dbError) return dbError(removed.dbError, 'portfolio-fees-delete')
    return NextResponse.json({ error: removed.error }, { status: removed.status })
  }
  return NextResponse.json({ ok: true })
}
