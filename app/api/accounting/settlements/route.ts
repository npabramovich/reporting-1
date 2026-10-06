import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertReadAccess, assertWriteAccess } from '@/lib/api-helpers'
import { resolveGroupOr400 } from '@/lib/accounting/http-vehicle'
import { vehicleIdByName } from '@/lib/accounting/vehicle-id'
import { loadSettlements } from '@/lib/accounting/capital-calls'
import { loadSettlementReviews } from '@/lib/accounting/settlement-reviews'

async function scope(req: NextRequest, write: boolean) {
  const client = await createClient()
  const { data: { user } } = await client.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  const gate = await (write ? assertWriteAccess : assertReadAccess)(admin, user.id)
  if (gate instanceof NextResponse) return gate
  const group = await resolveGroupOr400(admin, gate, req.nextUrl.searchParams.get('group'))
  if (group instanceof NextResponse) return group
  const vehicleId = await vehicleIdByName(admin, gate.fundId, group)
  return { admin, fundId: gate.fundId, vehicleId, group, userId: user.id }
}

export async function GET(req: NextRequest) {
  const ctx = await scope(req, false)
  if (ctx instanceof NextResponse) return ctx
  const kind = req.nextUrl.searchParams.get('kind')
  if (kind !== 'call' && kind !== 'distribution') return NextResponse.json({ error: 'Invalid payment kind' }, { status: 400 })
  const [payments, reviews] = await Promise.all([
    loadSettlements(ctx.admin, ctx.fundId, ctx.group, kind === 'call' ? 'receivable' : 'payable'),
    loadSettlementReviews(ctx.admin, ctx.fundId, ctx.vehicleId, kind),
  ])
  return NextResponse.json({ payments, reviews })
}

export async function POST(req: NextRequest) {
  const ctx = await scope(req, true)
  if (ctx instanceof NextResponse) return ctx
  // Every scoping in the RPC keys off the vehicle id; a null one matches no line, so say so here
  // rather than returning the RPC's "no recorded payment" for what is a registry problem.
  if (!ctx.vehicleId) return NextResponse.json({ error: `"${ctx.group}" is not in this fund's vehicle registry` }, { status: 400 })
  const body = await req.json().catch(() => null)
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  // A bounded list: one obligation is matched against a handful of wires, and the RPC loops once
  // per link under an advisory lock that serialises every other decision for this partner.
  if (!body || !['call', 'distribution'].includes(body.kind) || !uuid.test(body.lineId ?? '') || !Array.isArray(body.links) || body.links.length > 50 || typeof body.separateRemainder !== 'boolean' || body.links.some((link: any) => !uuid.test(link?.entryId ?? '') || typeof link.amount !== 'number' || !Number.isFinite(link.amount) || link.amount <= 0)) {
    return NextResponse.json({ error: 'Choose valid payment links and amounts' }, { status: 400 })
  }
  const { error } = await ctx.admin.rpc('review_capital_settlement' as any, {
    p_fund_id: ctx.fundId, p_vehicle_id: ctx.vehicleId, p_kind: body.kind, p_line_id: body.lineId,
    p_links: body.links, p_separate: body.separateRemainder, p_user_id: ctx.userId,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 409 })
  return NextResponse.json({ ok: true })
}
