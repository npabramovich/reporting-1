import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertAdminAccess } from '@/lib/api-helpers'
import { resolveGroupOr400 } from '@/lib/accounting/http-vehicle'
import { vehicleIdByName } from '@/lib/accounting/vehicle-id'
import { accountIdByCode } from '@/lib/accounting/persist'
import { dbError } from '@/lib/api-error'

// GET — list a vehicle's staged bank transactions.
export async function GET(req: NextRequest) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertAdminAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate
  const group = await resolveGroupOr400(admin, gate.fundId, req.nextUrl.searchParams.get('group'))
  if (group instanceof NextResponse) return group
  const vehicleId = await vehicleIdByName(admin, gate.fundId, group)

  const { data, error } = await admin
    .from('bank_transactions' as any)
    .select('id, txn_date, amount, description, counterparty, status, suggested_account_code, journal_entry_id')
    .eq('fund_id', gate.fundId)
    .eq('vehicle_id', vehicleId)
    .order('txn_date', { ascending: false })
    .limit(1000)
  if (error) return dbError(error, 'bank-transactions')
  return NextResponse.json(data ?? [])
}

// POST — act on a staged transaction.
// { action: 'post' | 'ignore' | 'setAccount', id, accountCode?, group? }
export async function POST(req: NextRequest) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertAdminAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate

  const { action, id, accountCode, group: bodyGroup } = await req.json().catch(() => ({}))
  const group = await resolveGroupOr400(admin, gate.fundId, bodyGroup ?? req.nextUrl.searchParams.get('group'))
  if (group instanceof NextResponse) return group
  if (!id || !['post', 'ignore', 'setAccount'].includes(action)) {
    return NextResponse.json({ error: 'action (post|ignore|setAccount) and id are required' }, { status: 400 })
  }
  const vehicleId = await vehicleIdByName(admin, gate.fundId, group)

  const { data: txn } = await admin
    .from('bank_transactions' as any)
    .select('id, journal_entry_id, status')
    .eq('id', id)
    .eq('fund_id', gate.fundId)
    .eq('vehicle_id', vehicleId)
    .maybeSingle()
  if (!txn) return NextResponse.json({ error: 'Transaction not found' }, { status: 404 })
  const entryId = (txn as any).journal_entry_id

  // Override the suggested account before posting: re-point the draft entry's
  // single non-cash posting to the chosen chart account.
  if (action === 'setAccount') {
    if ((txn as any).status !== 'drafted') return NextResponse.json({ error: 'Only a drafted transaction can be re-categorized' }, { status: 400 })
    const code = String(accountCode ?? '').trim()
    if (!code) return NextResponse.json({ error: 'accountCode is required' }, { status: 400 })
    const codes = await accountIdByCode(admin, gate.fundId, group)
    const newAccountId = codes.get(code)
    if (!newAccountId) return NextResponse.json({ error: 'Unknown account for this vehicle' }, { status: 400 })
    if (!entryId) return NextResponse.json({ error: 'No draft entry to update' }, { status: 400 })

    const cashId = codes.get('1000')
    const { data: postings } = await admin
      .from('journal_postings' as any)
      .select('id, account_id')
      .eq('journal_entry_id', entryId)
    const nonCash = ((postings as any[]) ?? []).filter(p => p.account_id !== cashId)
    if (nonCash.length !== 1) return NextResponse.json({ error: 'This entry has a custom allocation — edit it in the Journal.' }, { status: 400 })

    await admin.from('journal_postings' as any).update({ account_id: newAccountId }).eq('id', nonCash[0].id)
    await admin.from('bank_transactions' as any).update({ suggested_account_code: code }).eq('id', id).eq('fund_id', gate.fundId)
    return NextResponse.json({ ok: true, suggested_account_code: code })
  }

  if (action === 'post') {
    if (entryId) {
      const { error } = await admin.from('journal_entries' as any).update({ status: 'posted', posted_at: new Date().toISOString() }).eq('id', entryId).eq('fund_id', gate.fundId)
      if (error) return dbError(error, 'bank-post-entry')
    }
    await admin.from('bank_transactions' as any).update({ status: 'reconciled' }).eq('id', id).eq('fund_id', gate.fundId)
    return NextResponse.json({ ok: true, status: 'reconciled' })
  }

  if (entryId) await admin.from('journal_entries' as any).update({ status: 'void' }).eq('id', entryId).eq('fund_id', gate.fundId)
  await admin.from('bank_transactions' as any).update({ status: 'ignored' }).eq('id', id).eq('fund_id', gate.fundId)
  return NextResponse.json({ ok: true, status: 'ignored' })
}
