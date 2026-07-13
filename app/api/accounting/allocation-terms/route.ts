import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertAdminAccess } from '@/lib/api-helpers'
import { resolveGroupOr400 } from '@/lib/accounting/http-vehicle'
import { loadEntityNames, loadEntityClasses } from '@/lib/accounting/load'
import {
  loadAllocationBasis, saveAllocationBasis,
  loadPartnerTerms, savePartnerTerm,
  loadCommitmentEvents, commitmentsAsOf,
  type AllocationBasis, type AllocationCategory,
} from '@/lib/accounting/terms'

// GET — the vehicle's allocation basis, every partner's terms, and their current
// commitment (derived from the event log).
export async function GET(req: NextRequest) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertAdminAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate
  const group = await resolveGroupOr400(admin, gate.fundId, req.nextUrl.searchParams.get('group'))
  if (group instanceof NextResponse) return group

  const [basis, terms, events, names, classes] = await Promise.all([
    loadAllocationBasis(admin, gate.fundId, group),
    loadPartnerTerms(admin, gate.fundId, group),
    loadCommitmentEvents(admin, gate.fundId, group),
    loadEntityNames(admin, gate.fundId, group),
    loadEntityClasses(admin, gate.fundId, group),
  ])

  const commitments = commitmentsAsOf(events)
  const partners = Array.from(names.entries())
    .map(([lpEntityId, name]) => ({
      lpEntityId,
      name,
      partnerClass: classes.get(lpEntityId) ?? 'lp',
      commitment: commitments.get(lpEntityId) ?? 0,
      terms: terms.filter(t => t.lpEntityId === lpEntityId),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))

  return NextResponse.json({ basis, partners, events })
}

// POST
//   { action: 'basis', basis }                                   → set the allocation basis
//   { action: 'term', lpEntityId, category, participates, ... }  → upsert one partner term
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

  if (body?.action === 'basis') {
    const basis = body?.basis as AllocationBasis
    if (basis !== 'commitment' && basis !== 'capital_balance') {
      return NextResponse.json({ error: 'basis must be commitment or capital_balance' }, { status: 400 })
    }
    const result = await saveAllocationBasis(admin, gate.fundId, group, basis)
    if ('error' in result) return NextResponse.json({ error: result.error }, { status: 400 })
    return NextResponse.json({ ok: true })
  }

  if (body?.action === 'term') {
    if (!body?.lpEntityId || !body?.category) {
      return NextResponse.json({ error: 'lpEntityId and category are required' }, { status: 400 })
    }
    const result = await savePartnerTerm(admin, gate.fundId, group, {
      lpEntityId: body.lpEntityId,
      category: body.category as AllocationCategory,
      participates: body.participates !== false,
      weightOverride: body.weightOverride ?? null,
      rateOverride: body.rateOverride ?? null,
      memo: body.memo ?? null,
    })
    if ('error' in result) return NextResponse.json({ error: result.error }, { status: 400 })
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
