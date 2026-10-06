import { vehicleIdByName } from '@/lib/accounting/vehicle-id'
import { ensureVehicleAccounts } from '@/lib/accounting/provision-accounts'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
// accounting domain (lib/access/route-domains.ts). The middleware has already checked the caller's
// grant for this route + method; this resolves identity and keeps the demo out of writes.
import { assertWriteAccess } from '@/lib/api-helpers'
import { resolveGroupOr400 } from '@/lib/accounting/http-vehicle'
import { accountIdByCode, ensureCapitalAccounts, persistEntry } from '@/lib/accounting/persist'
import { roundCents } from '@/lib/accounting/ledger'
import type { Posting, JournalEntry } from '@/lib/accounting/types'

// POST — book per-LP opening capital balances as a posted opening entry (cutover).
// Capital in nets against cash (offset defaults to 1000); the investment purchase
// is booked separately. Body: { entryDate, offsetAccountCode?, group?, balances }
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

  const entryDate: string = body?.entryDate
  const offsetCode: string = body?.offsetAccountCode ?? '1000'
  const balances = (body?.balances ?? []) as { lpEntityId: string; amount: number }[]
  if (!entryDate || !Array.isArray(balances) || balances.length === 0) {
    return NextResponse.json({ error: 'entryDate and at least one balance are required' }, { status: 400 })
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(entryDate) || !Number.isFinite(Date.parse(entryDate)) || new Date(entryDate).toISOString().slice(0, 10) !== entryDate) {
    return NextResponse.json({ error: 'A valid opening date is required' }, { status: 400 })
  }
  if (new Set(balances.map(b => b.lpEntityId)).size !== balances.length || balances.some(b => !b.lpEntityId || !Number.isFinite(Number(b.amount)))) {
    return NextResponse.json({ error: 'Provide one finite balance per partner' }, { status: 400 })
  }
  const vehicleId = await vehicleIdByName(admin, gate.fundId, group)
  const { data: existing, error: overlapError } = await admin.from('journal_postings' as any)
    .select('id').eq('fund_id', gate.fundId).eq('vehicle_id', vehicleId).eq('book', 'actual')
    .in('lp_entity_id', balances.map(b => b.lpEntityId)).limit(1)
  if (overlapError) return NextResponse.json({ error: 'Could not check existing capital entries' }, { status: 500 })
  if (existing?.length) return NextResponse.json({ error: 'These partners already have accounting entries. Reconcile existing balances before importing an opening balance.' }, { status: 409 })

  await ensureVehicleAccounts(admin, gate.fundId, group)
  const codes = await accountIdByCode(admin, gate.fundId, group)
  const offsetId = codes.get(offsetCode)
  if (!offsetId) return NextResponse.json({ error: `Offset account ${offsetCode} not found — seed the chart first` }, { status: 400 })

  const capMap = await ensureCapitalAccounts(admin, gate.fundId, group, balances.map(b => b.lpEntityId))

  let total = 0
  const postings: Posting[] = []
  for (const b of balances) {
    const amount = roundCents(Number(b.amount))
    if (!Number.isFinite(amount)) return NextResponse.json({ error: `Invalid amount for ${b.lpEntityId}` }, { status: 400 })
    total = roundCents(total + amount)
    const accountId = capMap.get(b.lpEntityId)
    if (!accountId) return NextResponse.json({ error: `No capital account for ${b.lpEntityId}` }, { status: 400 })
    postings.push({ accountId, amount: -amount, currency: 'USD', lpEntityId: b.lpEntityId })
  }
  postings.push({ accountId: offsetId, amount: total, currency: 'USD', lpEntityId: null })

  const entry: JournalEntry = { fundId: gate.fundId, entryDate, memo: 'Opening balances', sourceType: 'opening_balance', sourceRef: 'partner-opening', postings }
  const result = await persistEntry(admin, gate.fundId, group, user.id, entry, 'posted')
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 400 })

  return NextResponse.json({ ok: true, entryId: result.entryId, lpCount: balances.length, total })
}
