import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertAdminAccess } from '@/lib/api-helpers'
import { loadOwnership } from '@/lib/accounting/load'
import { accountIdByCode, ensureCapitalAccounts, persistEntry } from '@/lib/accounting/persist'
import { computeManagementFee } from '@/lib/accounting/fees'
import {
  buildManagementFeeEntry,
  buildExpenseEntry,
  buildDistributionEntry,
  buildCarryEntry,
  type CapitalAccountMap,
} from '@/lib/accounting/entries'

// POST — compute (and optionally post) a period allocation entry.
// Body: { action, entryDate, post?, ...action-specific }
//   management_fee: { annualRate, periodFraction, overrides?: { [lpEntityId]: { rateOverride?, exempt? } } }
//   expense:        { amount }
//   distribution:   { perLp: { [lpEntityId]: amount } }
//   carry:          { perLp: { [lpEntityId]: amount } }
export async function POST(req: NextRequest) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = await assertAdminAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate

  const body = await req.json().catch(() => ({}))
  const { action, entryDate, post } = body
  if (!action || !entryDate) {
    return NextResponse.json({ error: 'action and entryDate are required' }, { status: 400 })
  }

  const owners = await loadOwnership(admin, gate.fundId)
  const codes = await accountIdByCode(admin, gate.fundId)
  const base = { fundId: gate.fundId, entryDate, memo: body.memo }

  // Resolve the LP entities this action touches and ensure capital accounts exist.
  const entityIds =
    action === 'distribution' || action === 'carry'
      ? Object.keys(body.perLp ?? {})
      : owners.map(o => o.lpEntityId)
  const capMap: CapitalAccountMap = await ensureCapitalAccounts(admin, gate.fundId, entityIds)

  let entry
  try {
    if (action === 'management_fee') {
      const overrides = (body.overrides ?? {}) as Record<string, { rateOverride?: number; exempt?: boolean }>
      const feeOwners = owners.map(o => ({
        lpEntityId: o.lpEntityId,
        basisAmount: o.commitment,
        rateOverride: overrides[o.lpEntityId]?.rateOverride ?? null,
        exempt: overrides[o.lpEntityId]?.exempt ?? false,
      }))
      const fee = computeManagementFee(
        { annualRate: Number(body.annualRate), basis: 'committed', periodFraction: Number(body.periodFraction) },
        feeOwners
      )
      const dueToGp = codes.get('2100') ?? codes.get('1000')
      if (!dueToGp) return NextResponse.json({ error: 'Seed the chart of accounts first' }, { status: 400 })
      entry = buildManagementFeeEntry(base, fee, capMap, dueToGp)
    } else if (action === 'expense') {
      const cash = codes.get('1000')
      if (!cash) return NextResponse.json({ error: 'Seed the chart of accounts first' }, { status: 400 })
      entry = buildExpenseEntry(base, Number(body.amount), owners, capMap, cash)
    } else if (action === 'distribution') {
      const cash = codes.get('1000')
      if (!cash) return NextResponse.json({ error: 'Seed the chart of accounts first' }, { status: 400 })
      const perLp = new Map<string, number>(Object.entries(body.perLp ?? {}).map(([k, v]) => [k, Number(v)]))
      entry = buildDistributionEntry(base, perLp, capMap, cash)
    } else if (action === 'carry') {
      const gpCapital = codes.get('3000')
      if (!gpCapital) return NextResponse.json({ error: 'Seed the chart of accounts first' }, { status: 400 })
      const perLp = new Map<string, number>(Object.entries(body.perLp ?? {}).map(([k, v]) => [k, Number(v)]))
      entry = buildCarryEntry(base, perLp, capMap, gpCapital)
    } else {
      return NextResponse.json({ error: `Unknown action ${action}` }, { status: 400 })
    }
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }

  if (!post) {
    // Preview only — return the proposed entry without persisting.
    return NextResponse.json({ preview: entry })
  }

  const result = await persistEntry(admin, gate.fundId, user.id, entry, 'posted')
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 400 })
  return NextResponse.json({ ok: true, entryId: result.entryId, entry })
}
