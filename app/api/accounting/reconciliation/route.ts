import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertAdminAccess } from '@/lib/api-helpers'
import { loadPostedLedger, loadEntityNames } from '@/lib/accounting/load'
import { computeCapitalAccounts } from '@/lib/accounting/capital-account'
import { reconcileCapital, type AdminCapitalAccount } from '@/lib/accounting/reconcile'

// POST — reconcile the ledger's capital accounts against admin figures.
// Body: { admin: { [lpEntityId]: { beginning?, contributions?, ..., ending? } }, tolerance? }
export async function POST(req: NextRequest) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = await assertAdminAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate

  const body = await req.json().catch(() => ({}))
  const adminInput = (body?.admin ?? {}) as Record<string, AdminCapitalAccount>
  const tolerance = typeof body?.tolerance === 'number' ? body.tolerance : 0.01

  const adminMap = new Map<string, AdminCapitalAccount>(
    Object.entries(adminInput).map(([id, v]) => [id, v])
  )

  const [{ capitalPostings }, names] = await Promise.all([
    loadPostedLedger(admin, gate.fundId),
    loadEntityNames(admin, gate.fundId),
  ])

  const ledger = computeCapitalAccounts(capitalPostings)
  const result = reconcileCapital(ledger, adminMap, tolerance)

  return NextResponse.json({
    ...result,
    names: Object.fromEntries(Array.from(names.entries())),
  })
}
