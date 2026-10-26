import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
// lp_capital domain (lib/access/route-domains.ts): one partner's capital statement, like the
// capital accounts it is built from.
import { assertReadAccess } from '@/lib/api-helpers'
import { resolveGroupOr400 } from '@/lib/accounting/http-vehicle'
import { lastQuarterEnd } from '@/lib/accounting/fund-performance'
import { rateLimit } from '@/lib/rate-limit'
import { loadIlpaReporting } from '@/lib/lp-templates/reporting-load'
import { reportingSheetRows } from '@/lib/lp-templates/reporting'

export const runtime = 'nodejs'

// GET ?group=&lpEntityId=&quarterEnd=&format=xlsx|json
//
// One partner's quarter as the ILPA Reporting Template (v. 2.0) states it, in this app's own layout
// and under the template's line labels: the NAV roll with fees, expenses, offsets and carried
// interest in ILPA's categories, the commitment reconciliation, and the fees the adviser received
// from portfolio companies. Each for the partner, the whole fund and the GP, QTD, YTD and ITD.
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

  const lpEntityId = sp.get('lpEntityId') ?? ''
  if (!/^[0-9a-f-]{36}$/i.test(lpEntityId)) return NextResponse.json({ error: 'lpEntityId is required' }, { status: 400 })
  const quarterEnd = sp.get('quarterEnd') || lastQuarterEnd(new Date().toISOString().slice(0, 10))

  const limited = await rateLimit({ key: `ilpa-reporting:${user.id}`, limit: 30, windowSeconds: 300 })
  if (limited) return limited

  let data
  try {
    data = await loadIlpaReporting(admin, gate.fundId, group, lpEntityId, quarterEnd)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'The report could not be built.' }, { status: 500 })
  }
  if ('error' in data) return NextResponse.json({ error: data.error }, { status: 400 })

  if (sp.get('format') === 'json') {
    return NextResponse.json(data, { headers: { 'Cache-Control': 'private, no-store' } })
  }

  const wb = XLSX.utils.book_new()
  const rows = reportingSheetRows(data)
  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws['!cols'] = [{ wch: 90 }, ...Array.from({ length: 9 }, () => ({ wch: 16 })), { wch: 10 }]
  // Figures as accounting numbers, the offset shares as percentages.
  for (let r = 0; r < rows.length; r++) {
    for (let c = 1; c < rows[r].length; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })]
      if (cell && typeof cell.v === 'number') cell.z = c === 10 ? '0%' : '#,##0.00;(#,##0.00);-'
    }
  }
  XLSX.utils.book_append_sheet(wb, ws, 'Reporting Template')
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
  const stem = `ILPA report - ${data.partner.name} - ${group} - ${quarterEnd}${data.status === 'draft' ? ' (draft)' : ''}`
    .replace(/[^\w .()-]+/g, ' ').replace(/\s+/g, ' ').trim()
  return new NextResponse(buf, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${stem}.xlsx"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
