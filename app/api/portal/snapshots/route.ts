import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveLpAccess } from '@/lib/api-helpers'
import { getSelfReadState } from '@/lib/lp-access-log'

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
  const { investorIds, lpAccountId } = access
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
  const sorted = Array.from(byId.values()).sort((a, b) => (b.as_of_date ?? '').localeCompare(a.as_of_date ?? ''))
  const readState = await getSelfReadState(admin, { lpAccountId, targetType: 'snapshot', targetIds: sorted.map(s => s.id) })
  const frozen = sorted.map(s => ({ ...s, last_viewed_at: readState[s.id] ?? null, viewHref: null as string | null, pdfUrl: null as string | null }))

  // The LIVE statement: for each enabled fund whose live report is PUBLISHED to this LP, offer a
  // single always-current capital statement (viewed on the overview, downloaded live). This is the
  // replacement for frozen snapshots — new publishes create these, not snapshot shares.
  const { data: liveShares } = await (admin as any)
    .from('lp_live_report_shares').select('fund_id').in('lp_investor_id', investorIds)
  const liveFundIds = Array.from(new Set(((liveShares ?? []) as any[]).map(s => s.fund_id as string))).filter(f => enabledFunds.has(f))
  const live = liveFundIds.map(fundId => ({
    id: `live:${fundId}`,
    name: 'Capital Statement',
    as_of_date: null as string | null,
    shared_at: '',
    last_viewed_at: null as string | null,
    viewHref: '/portal/overview' as string | null,
    pdfUrl: `/api/portal/statement/pdf?fund=${fundId}` as string | null,
  }))

  return NextResponse.json({ snapshots: [...live, ...frozen] })
}
