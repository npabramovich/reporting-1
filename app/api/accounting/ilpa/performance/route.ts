import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
// accounting domain (lib/access/route-domains.ts), like the fund performance report it sits beside.
import { assertReadAccess } from '@/lib/api-helpers'
import { resolveGroupOr400 } from '@/lib/accounting/http-vehicle'
import { lastQuarterEnd } from '@/lib/accounting/fund-performance'
import { rateLimit } from '@/lib/rate-limit'
import { loadIlpaPerformance } from '@/lib/lp-templates/performance-load'
import { performanceSheetRows } from '@/lib/lp-templates/performance'

export const runtime = 'nodejs'

// GET ?group=&asOf=&format=xlsx|json
//
// One vehicle's returns as the data the ILPA Performance Template (Granular Methodology, v. 1.1)
// asks for, in this app's own layout and under ILPA's field and transaction-type names: net and
// gross IRR and multiple, with and without the subscription facility, the portfolio's gross
// returns, and every typed cash flow behind them.
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertReadAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate
  const sp = req.nextUrl.searchParams
  const group = await resolveGroupOr400(admin, gate, sp.get('group'))
  if (group instanceof NextResponse) return group

  const asOf = sp.get('asOf') || lastQuarterEnd(new Date().toISOString().slice(0, 10))
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return NextResponse.json({ error: 'asOf must be YYYY-MM-DD' }, { status: 400 })

  const limited = await rateLimit({ key: `ilpa-performance:${user.id}`, limit: 30, windowSeconds: 300 })
  if (limited) return limited

  let data
  try {
    data = await loadIlpaPerformance(admin, gate.fundId, group, asOf)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'The performance data could not be built.' }, { status: 500 })
  }

  if (sp.get('format') === 'json') {
    return NextResponse.json(data, { headers: { 'Cache-Control': 'private, no-store' } })
  }

  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet(performanceSheetRows(data))
  ws['!cols'] = [{ wch: 16 }, { wch: 90 }, { wch: 22 }, { wch: 18 }, { wch: 18 }, { wch: 20 }, { wch: 20 }, { wch: 22 }]
  XLSX.utils.book_append_sheet(wb, ws, 'Performance')
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
  const stem = `ILPA performance - ${group} - ${asOf}`.replace(/[^\w .-]+/g, ' ').replace(/\s+/g, ' ').trim()
  return new NextResponse(buf, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${stem}.xlsx"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
