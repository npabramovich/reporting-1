import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
// lp_capital domain (lib/access/route-domains.ts). The proxy has already checked the caller's grant
// for this route + method; these resolve identity and keep the demo out of writes.
import { assertReadAccess, assertWriteAccess } from '@/lib/api-helpers'
import { resolveGroupOr400 } from '@/lib/accounting/http-vehicle'
import { vehicleIdByName } from '@/lib/accounting/vehicle-id'
import { recordAudit } from '@/lib/audit/events'
import {
  facilityStatus,
  recordFacilityEvent,
  removeFacility,
  removeFacilityEvent,
  saveFacility,
} from '@/lib/accounting/credit-facility'

// GET ?group=&asOf= — the vehicle's credit facilities, each with its balance and its rows.
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertReadAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate
  const group = await resolveGroupOr400(admin, gate, req.nextUrl.searchParams.get('group'))
  if (group instanceof NextResponse) return group
  const asOf = req.nextUrl.searchParams.get('asOf') || undefined
  if (asOf && !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return NextResponse.json({ error: 'asOf must be YYYY-MM-DD' }, { status: 400 })
  return NextResponse.json(await facilityStatus(admin, gate.fundId, group, asOf))
}

// POST { action, ... }
//   save_facility   { id?, name, kind, lender, commitmentAmount, openedOn, maturesOn, rateDescription, notes }
//   remove_facility { id }                       only when nothing is recorded on it
//   record          { facilityId, type, date, amount, purpose?, callId?, entryId?, memo? }
//                   posts the entry, or links `entryId` when it is already on the books
//   remove_row      { id }                       a posted row's entry must be voided first
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

  const audit = async (action: 'credit_facility.save' | 'credit_facility.remove' | 'credit_facility.record' | 'credit_facility.remove_row', subjectId: string, details: Record<string, unknown>) =>
    recordAudit(admin, {
      fundId: gate.fundId, vehicleId: await vehicleIdByName(admin, gate.fundId, group), actorId: user.id,
      action, subjectType: action === 'credit_facility.save' || action === 'credit_facility.remove' ? 'credit_facility' : 'credit_facility_event',
      subjectId, details,
    })

  switch (body?.action) {
    case 'save_facility': {
      const r = await saveFacility(admin, gate.fundId, group, user.id, body)
      if ('error' in r) return NextResponse.json({ error: r.error }, { status: 400 })
      await audit('credit_facility.save', r.facility.id, { name: r.facility.name, kind: r.facility.kind, commitmentAmount: r.facility.commitmentAmount })
      return NextResponse.json(r)
    }
    case 'remove_facility': {
      const r = await removeFacility(admin, gate.fundId, group, body?.id)
      if ('error' in r) return NextResponse.json({ error: r.error }, { status: 400 })
      await audit('credit_facility.remove', String(body.id), {})
      return NextResponse.json(r)
    }
    case 'record': {
      const r = await recordFacilityEvent(admin, gate.fundId, group, user.id, body)
      if ('error' in r) return NextResponse.json({ error: r.error }, { status: 400 })
      const c = r.checked
      await audit('credit_facility.record', r.id, {
        facility: c.facility.name, type: c.type, date: c.date, amount: c.amount, purpose: c.purpose,
        callId: c.callId, entryId: r.entryId, linked: !!c.link,
      })
      return NextResponse.json({ ok: true, id: r.id, entryId: r.entryId })
    }
    case 'remove_row': {
      const r = await removeFacilityEvent(admin, gate.fundId, group, body?.id)
      if ('error' in r) return NextResponse.json({ error: r.error }, { status: 400 })
      await audit('credit_facility.remove_row', r.event.id, { type: r.event.type, date: r.event.date, amount: r.event.amount })
      return NextResponse.json(r)
    }
    default:
      return NextResponse.json({ error: "action must be 'save_facility', 'remove_facility', 'record' or 'remove_row'" }, { status: 400 })
  }
}
