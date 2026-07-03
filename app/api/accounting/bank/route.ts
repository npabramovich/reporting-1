import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertAdminAccess } from '@/lib/api-helpers'
import { resolveGroupOr400 } from '@/lib/accounting/http-vehicle'
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

  const { data, error } = await admin
    .from('bank_transactions' as any)
    .select('id, txn_date, amount, description, counterparty, status, suggested_account_code, journal_entry_id')
    .eq('fund_id', gate.fundId)
    .eq('portfolio_group', group)
    .order('txn_date', { ascending: false })
    .limit(1000)
  if (error) return dbError(error, 'bank-transactions')
  return NextResponse.json(data ?? [])
}

// POST — act on a staged transaction. { action: 'post' | 'ignore', id, group? }
export async function POST(req: NextRequest) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertAdminAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate

  const { action, id, group: bodyGroup } = await req.json().catch(() => ({}))
  const group = await resolveGroupOr400(admin, gate.fundId, bodyGroup ?? req.nextUrl.searchParams.get('group'))
  if (group instanceof NextResponse) return group
  if (!id || !['post', 'ignore'].includes(action)) {
    return NextResponse.json({ error: 'action (post|ignore) and id are required' }, { status: 400 })
  }

  const { data: txn } = await admin
    .from('bank_transactions' as any)
    .select('id, journal_entry_id')
    .eq('id', id)
    .eq('fund_id', gate.fundId)
    .eq('portfolio_group', group)
    .maybeSingle()
  if (!txn) return NextResponse.json({ error: 'Transaction not found' }, { status: 404 })
  const entryId = (txn as any).journal_entry_id

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
