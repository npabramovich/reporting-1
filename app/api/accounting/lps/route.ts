import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertAdminAccess } from '@/lib/api-helpers'
import { resolveGroupOr400 } from '@/lib/accounting/http-vehicle'

// POST — the "strict" accounting-side add of a partner (LP or GP) to the vehicle
// being viewed. Reuses the investor/entity if they already exist (names are
// unique per fund), sets the entity's partner class, and records the commitment.
// The commitment is attached to the fund's latest snapshot so the partner also
// shows up in LP reporting; if there's no snapshot yet, null is fine — accounting
// reads investments by vehicle regardless of snapshot.
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

  const name = String(body?.name ?? '').trim()
  if (!name) return NextResponse.json({ error: 'A name is required' }, { status: 400 })
  const partnerClass = body?.partnerClass === 'gp' ? 'gp' : 'lp'
  const commitment = Number(body?.commitment ?? 0)
  if (!Number.isFinite(commitment) || commitment < 0) return NextResponse.json({ error: 'A valid commitment is required' }, { status: 400 })

  // Investor — reuse by name (unique per fund) or create.
  const { data: existingInv } = await admin.from('lp_investors' as any).select('id').eq('fund_id', gate.fundId).eq('name', name).maybeSingle()
  let investorId = (existingInv as any)?.id
  if (!investorId) {
    const { data: inv, error } = await admin.from('lp_investors' as any).insert({ fund_id: gate.fundId, name }).select('id').single()
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    investorId = (inv as any).id
  }

  // Entity — reuse by name (unique per fund) or create; set its partner class.
  const { data: existingEnt } = await admin.from('lp_entities' as any).select('id').eq('fund_id', gate.fundId).eq('entity_name', name).maybeSingle()
  let entityId = (existingEnt as any)?.id
  if (entityId) {
    await admin.from('lp_entities' as any).update({ partner_class: partnerClass }).eq('id', entityId)
  } else {
    const { data: ent, error } = await admin.from('lp_entities' as any)
      .insert({ fund_id: gate.fundId, investor_id: investorId, entity_name: name, partner_class: partnerClass })
      .select('id').single()
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    entityId = (ent as any).id
  }

  // Commitment — attach to the fund's latest snapshot if there is one.
  const { data: snap } = await admin.from('lp_snapshots' as any).select('id').eq('fund_id', gate.fundId).order('created_at', { ascending: false }).limit(1).maybeSingle()
  const snapshotId = (snap as any)?.id ?? null

  const { data: existingInvst } = await admin.from('lp_investments' as any)
    .select('id').eq('fund_id', gate.fundId).eq('entity_id', entityId).eq('portfolio_group', group).limit(1)
  if (Array.isArray(existingInvst) && existingInvst.length > 0) {
    await admin.from('lp_investments' as any).update({ commitment }).eq('id', (existingInvst[0] as any).id)
  } else {
    const { error } = await admin.from('lp_investments' as any).insert({
      fund_id: gate.fundId,
      entity_id: entityId,
      portfolio_group: group,
      commitment,
      snapshot_id: snapshotId,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  }

  return NextResponse.json({ ok: true, entityId, partnerClass })
}
