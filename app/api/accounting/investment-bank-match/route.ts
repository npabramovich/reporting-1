import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
// accounting domain (lib/access/route-domains.ts). The middleware has already checked the caller's
// grant for this route + method; these resolve identity and keep the demo out of writes.
import { assertWriteAccess, assertReadAccess } from '@/lib/api-helpers'
import { resolveGroupOr400 } from '@/lib/accounting/http-vehicle'
import { awaitingBankMatch, matchInvestmentToBank, postWithoutBankMatch } from '@/lib/accounting/investment-bank-match'

// GET — investment entries waiting for their bank match, each with suggested bank rows.
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertReadAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate
  const group = await resolveGroupOr400(admin, gate, req.nextUrl.searchParams.get('group'))
  if (group instanceof NextResponse) return group
  return NextResponse.json(await awaitingBankMatch(admin, gate.fundId, group))
}

// POST — { transactionId, bankTransactionId, group? } matches and posts;
//        { transactionId, withoutBankMatch: true, group? } posts on an explicit decision that
//        this payment has no bank row (a vehicle with no bank feed).
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
  const transactionId = typeof body?.transactionId === 'string' ? body.transactionId : null
  if (!transactionId) return NextResponse.json({ error: 'transactionId is required' }, { status: 400 })

  const result = body?.withoutBankMatch === true
    ? await postWithoutBankMatch(admin, gate.fundId, group, user.id, transactionId)
    : typeof body?.bankTransactionId === 'string'
      ? await matchInvestmentToBank(admin, gate.fundId, group, user.id, transactionId, body.bankTransactionId)
      : { error: 'bankTransactionId is required, or withoutBankMatch: true' }
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 400 })
  return NextResponse.json(result)
}
