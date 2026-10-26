// Carried interest held in a third-party escrow, for the ILPA Reporting Template (lib/accounting/carry-escrow.ts).
//
//   GET    ?group=X                       the vehicle's escrow deposits and releases, oldest first
//   POST   ?group=X  { date, kind: deposit|release, amount, memo? }   record one
//   DELETE ?group=X&id=ID                 remove one

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
// gp_economics domain (see lib/access/route-domains.ts): carry, like the waterfall terms.
import { assertWriteAccess, assertReadAccess } from '@/lib/api-helpers'
import { resolveGroupOr400 } from '@/lib/accounting/http-vehicle'
import { addEscrowEvent, deleteEscrowEvent, escrowBalance, loadEscrowEvents } from '@/lib/accounting/carry-escrow'
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

  const events = await loadEscrowEvents(admin, gate.fundId, group)
  if ('error' in events) return NextResponse.json({ error: events.error }, { status: 500 })
  return NextResponse.json({ group, events, balance: escrowBalance(events) })
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

  const saved = await addEscrowEvent(admin, gate.fundId, group, body, user.id)
  if ('error' in saved) {
    if (saved.dbError) return dbError(saved.dbError, 'carry-escrow-post')
    return NextResponse.json({ error: saved.error }, { status: saved.status })
  }
  return NextResponse.json({ ok: true, event: saved.event })
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

  const removed = await deleteEscrowEvent(admin, gate.fundId, group, req.nextUrl.searchParams.get('id') ?? '')
  if ('error' in removed) {
    if (removed.dbError) return dbError(removed.dbError, 'carry-escrow-delete')
    return NextResponse.json({ error: removed.error }, { status: removed.status })
  }
  return NextResponse.json({ ok: true })
}
