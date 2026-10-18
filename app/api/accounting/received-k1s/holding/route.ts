import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertReadAccess } from '@/lib/api-helpers'
import { loadGateAccess } from '@/lib/access/request-context'
import { canSeeVehicle } from '@/lib/access/scope'
import { K1_EXPECTED_HOLDING_TYPE } from '@/lib/tax/received-k1s'
import { holdingK1History } from '@/lib/tax/holding-k1-history'

// One fund holding's K-1 income by year, for the table on its page (holding-k1-income.tsx).
//
// Gated on tax read like the rest of received-k1s (route-domains.ts): the amounts a holding
// reported are tax data, and the page hides the table when this answers 403. The table is
// service-role only (tests/tax-data-api-grants.test.ts), so this route is its only reader.

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertReadAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate

  const companyId = req.nextUrl.searchParams.get('companyId')
  if (!companyId) return NextResponse.json({ error: 'companyId is required' }, { status: 400 })

  // This fund's fund holding, or nothing.
  const { data: company } = await admin
    .from('companies' as any)
    .select('id')
    .eq('id', companyId)
    .eq('fund_id', gate.fundId)
    .eq('holding_type', K1_EXPECTED_HOLDING_TYPE)
    .maybeSingle()
  if (!company) return NextResponse.json({ error: 'Holding not found' }, { status: 404 })

  const [{ data: rows, error }, access, { data: vehicles }] = await Promise.all([
    admin.from('received_k1s' as any).select('*').eq('fund_id', gate.fundId).eq('company_id', companyId),
    loadGateAccess(admin, gate),
    admin.from('fund_vehicles' as any).select('id, name').eq('fund_id', gate.fundId),
  ])
  if (error) return NextResponse.json({ error: 'Could not load the K-1s.' }, { status: 500 })

  // Only the viewer's own entities; a K-1 recorded without one only for a viewer who sees them all.
  const years = holdingK1History((rows as any[]) ?? [], v => canSeeVehicle(access, v))
  const names = new Map(((vehicles as any[]) ?? []).map(v => [v.id as string, v.name as string]))
  return NextResponse.json({
    years: years.map(y => ({ ...y, vehicleName: y.vehicleId ? names.get(y.vehicleId) ?? null : null })),
  })
}
