import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertAdminAccess } from '@/lib/api-helpers'
import { resolveGroupOr400 } from '@/lib/accounting/http-vehicle'
import { loadPostedLedger, loadEntityNames, loadEntityClasses } from '@/lib/accounting/load'
import { computeCapitalAccounts, totalNav } from '@/lib/accounting/capital-account'
import { resolvePeriod, customPeriod, type PeriodPreset } from '@/lib/accounting/statement-period'

// GET — per-LP capital-account roll-forward for a vehicle, derived from posted entries.
//
// Returns TWO roll-forwards per LP: `period` (activity within the statement period,
// opening with the balance carried in) and `itd` (inception to date). A capital
// account statement shows both columns side by side.
//
//   ?preset=this_quarter|last_quarter|ytd|prior_year|itd   — or —
//   ?start=YYYY-MM-DD&end=YYYY-MM-DD                       (custom window)
export async function GET(req: NextRequest) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = await assertAdminAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate
  const group = await resolveGroupOr400(admin, gate.fundId, req.nextUrl.searchParams.get('group'))
  if (group instanceof NextResponse) return group

  const sp = req.nextUrl.searchParams
  const preset = sp.get('preset') as PeriodPreset | null
  const start = sp.get('start')
  const end = sp.get('end')
  const period = preset && preset !== 'custom' ? resolvePeriod(preset) : customPeriod(start, end)

  // One load, unfiltered by date: both roll-forwards are computed from it, and the
  // period one needs the pre-period history anyway to open with a carried-in balance.
  const [{ capitalPostings }, names, classes] = await Promise.all([
    loadPostedLedger(admin, gate.fundId, group),
    loadEntityNames(admin, gate.fundId, group),
    loadEntityClasses(admin, gate.fundId, group),
  ])

  const periodAccounts = computeCapitalAccounts(capitalPostings, period)
  const itdAccounts = computeCapitalAccounts(capitalPostings, { end: period.end })

  const rows = Array.from(itdAccounts.entries())
    .map(([lpEntityId, itd]) => ({
      lpEntityId,
      name: names.get(lpEntityId) ?? lpEntityId,
      partnerClass: classes.get(lpEntityId) ?? 'lp',
      period: periodAccounts.get(lpEntityId) ?? null,
      itd,
      // The flat spread keeps the previous response shape working for existing
      // consumers (reconciliation view, agent tools) — it's the ITD roll-forward.
      ...itd,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))

  return NextResponse.json({
    rows,
    nav: totalNav(itdAccounts),
    period,
  })
}
