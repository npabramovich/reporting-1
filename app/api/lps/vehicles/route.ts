import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertWriteAccess } from '@/lib/api-helpers'

/**
 * Admin-only: the distinct investment vehicles (lp_investments.portfolio_group)
 * for the fund. A "vehicle" isn't a first-class table — it's the free-text
 * portfolio_group on investment rows — so we derive the list the same way the
 * LP batch editor does: distinct values across all snapshots. Used to populate
 * the "share with a vehicle" picker for LP documents.
 */
export async function GET() {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const writeCheck = await assertWriteAccess(admin, user.id)
  if (writeCheck instanceof NextResponse) return writeCheck
  if (writeCheck.role !== 'admin') return NextResponse.json({ error: 'Admin access required' }, { status: 403 })

  const { data, error } = await (admin as any)
    .from('lp_investments')
    .select('portfolio_group')
    .eq('fund_id', writeCheck.fundId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const vehicles = Array.from(
    new Set(((data ?? []) as { portfolio_group: string | null }[])
      .map(r => (r.portfolio_group ?? '').trim())
      .filter(Boolean))
  ).sort((a, b) => a.localeCompare(b))

  return NextResponse.json({ vehicles })
}
