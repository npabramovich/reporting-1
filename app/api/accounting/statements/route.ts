import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertAdminAccess } from '@/lib/api-helpers'
import { resolveGroupOr400 } from '@/lib/accounting/http-vehicle'
import { loadPostedLedger } from '@/lib/accounting/load'
import { trialBalance, balanceSheet, incomeStatement } from '@/lib/accounting/statements'

// GET — trial balance + balance sheet + income statement for a vehicle.
export async function GET(req: NextRequest) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = await assertAdminAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate
  const group = await resolveGroupOr400(admin, gate.fundId, req.nextUrl.searchParams.get('group'))
  if (group instanceof NextResponse) return group

  const { accounts, postings } = await loadPostedLedger(admin, gate.fundId, group)
  return NextResponse.json({
    trialBalance: trialBalance(accounts, postings),
    balanceSheet: balanceSheet(accounts, postings),
    incomeStatement: incomeStatement(accounts, postings),
  })
}
