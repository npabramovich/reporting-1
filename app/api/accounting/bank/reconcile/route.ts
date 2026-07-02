import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertAdminAccess } from '@/lib/api-helpers'
import { loadPostedLedger } from '@/lib/accounting/load'
import { accountBalances } from '@/lib/accounting/ledger'
import { summarizeBankRec, type BankTxnState } from '@/lib/accounting/bank'

// GET — bank reconciliation: ledger cash vs the bank feed.
export async function GET() {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertAdminAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate

  // Ledger cash balance (posted entries hitting the cash account, code 1000).
  const { accounts, postings } = await loadPostedLedger(admin, gate.fundId)
  const cash = accounts.find(a => a.code === '1000')
  const ledgerCashBalance = cash ? (accountBalances(postings).get(cash.id) ?? 0) : 0

  // Bank feed (exclude ignored rows). matched = reconciled (its entry is posted).
  const { data } = await admin
    .from('bank_transactions' as any)
    .select('amount, status')
    .eq('fund_id', gate.fundId)
    .neq('status', 'ignored')

  const txns: BankTxnState[] = ((data as any[]) ?? []).map(t => ({
    amount: Number(t.amount),
    matched: t.status === 'reconciled',
  }))

  return NextResponse.json(summarizeBankRec(txns, ledgerCashBalance))
}
