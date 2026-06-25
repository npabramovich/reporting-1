import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveLpAccess } from '@/lib/api-helpers'

/**
 * LP portal — list the snapshots shared with the signed-in LP. Scoped strictly
 * to their investor rows via resolveLpAccess; never consults fund_members.
 */
export async function GET() {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const access = await resolveLpAccess(admin, user.id)
  if (access instanceof NextResponse) return access
  const { investorIds } = access
  if (investorIds.length === 0) return NextResponse.json({ snapshots: [] })

  const { data: shares, error } = await (admin as any)
    .from('lp_snapshot_shares')
    .select('snapshot_id, shared_at, fund_id, lp_snapshots(id, name, as_of_date)')
    .in('lp_investor_id', investorIds)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Only funds with the LP portal switched on expose their snapshots.
  const fundIds = Array.from(new Set((shares ?? []).map((s: any) => s.fund_id as string)))
  let enabledFunds = new Set<string>()
  if (fundIds.length) {
    const { data: ef } = await (admin as any)
      .from('fund_settings')
      .select('fund_id')
      .eq('lp_portal_enabled', true)
      .in('fund_id', fundIds)
    enabledFunds = new Set((ef ?? []).map((f: any) => f.fund_id as string))
  }

  // A snapshot may be shared with several of the LP's investors — dedupe.
  const byId = new Map<string, { id: string; name: string; as_of_date: string | null; shared_at: string }>()
  for (const s of (shares ?? []) as any[]) {
    if (!enabledFunds.has(s.fund_id)) continue
    const snap = s.lp_snapshots
    if (snap && !byId.has(snap.id)) {
      byId.set(snap.id, { id: snap.id, name: snap.name, as_of_date: snap.as_of_date, shared_at: s.shared_at })
    }
  }
  const snapshots = Array.from(byId.values()).sort((a, b) => (b.as_of_date ?? '').localeCompare(a.as_of_date ?? ''))
  return NextResponse.json({ snapshots })
}
