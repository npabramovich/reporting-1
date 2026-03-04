import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertWriteAccess } from '@/lib/api-helpers'
import { dbError } from '@/lib/api-error'
import { logActivity } from '@/lib/activity'

// ---------------------------------------------------------------------------
// PATCH — update a transaction
// ---------------------------------------------------------------------------

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; txnId: string } }
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  const writeCheck = await assertWriteAccess(admin, user.id)
  if (writeCheck instanceof NextResponse) return writeCheck

  // Verify transaction exists and belongs to this company
  const { data: existing } = await admin
    .from('investment_transactions' as any)
    .select('id, company_id, fund_id')
    .eq('id', params.txnId)
    .eq('company_id', params.id)
    .maybeSingle() as { data: { id: string; company_id: string; fund_id: string } | null }

  if (!existing) return NextResponse.json({ error: 'Transaction not found' }, { status: 404 })

  const body = await req.json()

  // Only allow updating known fields
  const allowedFields = [
    'round_name', 'transaction_date', 'notes',
    'investment_cost', 'interest_converted', 'shares_acquired', 'share_price',
    'cost_basis_exited', 'proceeds_received', 'proceeds_escrow',
    'proceeds_written_off', 'proceeds_per_share',
    'unrealized_value_change', 'current_share_price',
    'postmoney_valuation', 'latest_postmoney_valuation', 'exit_valuation',
    'original_currency',
    'original_investment_cost', 'original_share_price', 'original_postmoney_valuation',
    'original_proceeds_received', 'original_proceeds_per_share', 'original_exit_valuation',
    'original_unrealized_value_change', 'original_current_share_price',
    'original_latest_postmoney_valuation',
  ]

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  for (const key of allowedFields) {
    if (key in body) updates[key] = body[key]
  }

  const { data: txn, error } = await admin
    .from('investment_transactions' as any)
    .update(updates)
    .eq('id', params.txnId)
    .select('*')
    .single()

  if (error) return dbError(error, 'companies-id-investments-txnId-patch')

  logActivity(admin, existing.fund_id, user.id, 'investment.update', {
    companyId: params.id,
    transactionId: params.txnId,
  })

  return NextResponse.json(txn)
}

// ---------------------------------------------------------------------------
// DELETE — delete a transaction
// ---------------------------------------------------------------------------

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; txnId: string } }
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  const writeCheck = await assertWriteAccess(admin, user.id)
  if (writeCheck instanceof NextResponse) return writeCheck

  // Verify transaction exists and belongs to this company
  const { data: existing } = await admin
    .from('investment_transactions' as any)
    .select('id, company_id, fund_id')
    .eq('id', params.txnId)
    .eq('company_id', params.id)
    .maybeSingle() as { data: { id: string; company_id: string; fund_id: string } | null }

  if (!existing) return NextResponse.json({ error: 'Transaction not found' }, { status: 404 })

  const { error } = await admin
    .from('investment_transactions' as any)
    .delete()
    .eq('id', params.txnId)

  if (error) return dbError(error, 'companies-id-investments-txnId-delete')

  logActivity(admin, existing.fund_id, user.id, 'investment.delete', {
    companyId: params.id,
    transactionId: params.txnId,
  })

  return NextResponse.json({ success: true })
}
