// A vehicle's carry terms — what the close accrues carried interest on.
//
//   GET  ?group=X   the vehicle's terms + the partners who could receive the carry
//   PUT  ?group=X   set them
//
// Absent terms mean NO CARRY, and that is the only safe default: accruing carry nobody agreed
// to is worse than accruing none at all.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
// gp_economics domain (see lib/access/route-domains.ts). The middleware has already checked the
// caller's grant for this route + method; these resolve identity and keep the demo out of writes.
import { assertWriteAccess, assertReadAccess } from '@/lib/api-helpers'
import { resolveGroupOr400 } from '@/lib/accounting/http-vehicle'
import { saveWaterfallTerms } from '@/lib/accounting/waterfall-terms'
import { loadCarryTerms } from '@/lib/accounting/carry'
import { loadEntityNames } from '@/lib/accounting/load'
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

  const [terms, names] = await Promise.all([
    loadCarryTerms(admin, gate.fundId, group),
    loadEntityNames(admin, gate.fundId, group),
  ])

  // Whoever could receive the carry. Normally the GP entity, but we don't force that — some
  // structures accrue it to a named associate vehicle's entity instead.
  const { data: entities } = await admin
    .from('lp_entities' as any)
    .select('id, entity_name, partner_class')
    .eq('fund_id', gate.fundId)
    .order('entity_name')

  return NextResponse.json({
    group,
    terms,
    partners: Array.from(names.entries()).map(([id, name]) => ({ lpEntityId: id, name })),
    candidates: ((entities as any[]) ?? []).map(e => ({
      lpEntityId: e.id,
      name: e.entity_name,
      partnerClass: e.partner_class ?? 'lp',
    })),
  })
}

export async function PUT(req: NextRequest) {
  const supabase = await createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertWriteAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate

  const body = await req.json().catch(() => ({}))
  const group = await resolveGroupOr400(admin, gate, body?.group ?? req.nextUrl.searchParams.get('group'))
  if (group instanceof NextResponse) return group

  // The one write path, shared with the approved set_waterfall_terms action (lib/accounting/waterfall-terms.ts).
  const saved = await saveWaterfallTerms(admin, gate.fundId, group, body ?? {})
  if ('error' in saved) {
    if (saved.dbError) return dbError(saved.dbError, 'waterfall-terms-put')
    return NextResponse.json({ error: saved.error }, { status: saved.status })
  }

  return NextResponse.json({ ok: true })
}
