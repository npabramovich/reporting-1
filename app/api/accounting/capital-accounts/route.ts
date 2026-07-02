import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertAdminAccess } from '@/lib/api-helpers'
import { loadPostedLedger, loadEntityNames } from '@/lib/accounting/load'
import { computeCapitalAccounts, totalNav } from '@/lib/accounting/capital-account'

// GET — per-LP capital-account roll-forward, derived from posted entries.
export async function GET() {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = await assertAdminAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate

  const [{ capitalPostings }, names] = await Promise.all([
    loadPostedLedger(admin, gate.fundId),
    loadEntityNames(admin, gate.fundId),
  ])

  const accounts = computeCapitalAccounts(capitalPostings)
  const rows = Array.from(accounts.entries())
    .map(([lpEntityId, account]) => ({
      lpEntityId,
      name: names.get(lpEntityId) ?? lpEntityId,
      ...account,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))

  return NextResponse.json({ rows, nav: totalNav(accounts) })
}
