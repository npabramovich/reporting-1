// Archived LP capital movements. Live reporting uses dated positions and accounting evidence.
//
//   GET    ?group=X            read archived movements and LP roster
//   POST/PUT/DELETE           retired writes; return 410
//   PATCH  ?group=X            retired source switch; returns 410
//
// The API speaks `capitalDelta` (positive = the LP's capital goes up). The debit-positive
// storage convention never leaves lib/accounting/lp-events.ts.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { dbError } from '@/lib/api-error'
// lp_capital domain (lib/access/route-domains.ts). The middleware has already checked the caller's
// grant for this route + method; these resolve identity and keep the demo out of writes.
import { assertWriteAccess, assertReadAccess } from '@/lib/api-helpers'
import { resolveGroupOr400 } from '@/lib/accounting/http-vehicle'
import { loadEntityNames } from '@/lib/accounting/load'
import {
  resolveScope, listEvents,
  LP_EVENT_TYPES,
} from '@/lib/accounting/lp-events'
import { vehicleIdByName } from '@/lib/accounting/vehicle-id'

async function scopeOr400(admin: any, fundId: string, group: string) {
  const scope = await resolveScope(admin, fundId, group)
  if ('error' in scope) return NextResponse.json({ error: scope.error }, { status: 400 })
  return scope
}

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertReadAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate
  const group = await resolveGroupOr400(admin, gate, req.nextUrl.searchParams.get('group'))
  if (group instanceof NextResponse) return group

  const scope = await scopeOr400(admin, gate.fundId, group)
  if (scope instanceof NextResponse) return scope

  const [events, names] = await Promise.all([
    listEvents(admin, scope),
    loadEntityNames(admin, gate.fundId, group),
  ])

  // The LP roster the importer and the manual form pick from. Falls back to the fund's whole
  // entity list when the vehicle has no commitments recorded yet — otherwise a brand-new SPV
  // would offer no LPs to enter events against, which is exactly when you need them.
  let roster = Array.from(names.entries()).map(([id, name]) => ({ id, name }))
  if (roster.length === 0) {
    const { data } = await admin
      .from('lp_entities' as any)
      .select('id, entity_name')
      .eq('fund_id', gate.fundId)
      .order('entity_name')
    roster = ((data as any[]) ?? []).map(r => ({ id: r.id, name: r.entity_name }))
  }

  return NextResponse.json({ group, retired: true, events, roster, types: LP_EVENT_TYPES })
}

/** Legacy movements are retained for audit; live capital is maintained as dated positions. */
async function retiredEventWrite(req: NextRequest) {
  const supabase = await createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertWriteAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate
  const group = await resolveGroupOr400(admin, gate, req.nextUrl.searchParams.get('group'))
  if (group instanceof NextResponse) return group
  return NextResponse.json({ error: 'Legacy capital-event writes and source switching have been retired. Enter reported balances on LP capital accounts, or record accounting transactions.', href: '/lps/capital' }, { status: 410 })
}
export const POST = retiredEventWrite
export const PUT = retiredEventWrite
export const DELETE = retiredEventWrite
export const PATCH = retiredEventWrite
