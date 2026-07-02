import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertAdminAccess } from '@/lib/api-helpers'
import { loadOwnership, loadPostedLedger } from '@/lib/accounting/load'
import { accountIdByCode, ensureCapitalAccounts, persistEntry } from '@/lib/accounting/persist'
import { computeManagementFee } from '@/lib/accounting/fees'
import { accountBalances } from '@/lib/accounting/ledger'
import {
  buildManagementFeeEntry,
  buildExpenseEntry,
  buildGainEntry,
  buildDistributionEntry,
  buildCarryEntry,
  buildPeriodCloseEntry,
  type CapitalAccountMap,
  type BridgeAccounts,
} from '@/lib/accounting/entries'

// Standard account codes from the default chart.
const CODE = {
  cash: '1000',
  dueToGp: '2100',
  gpCapital: '3000',
  bridge: '3200',
  realizedGains: '4000',
  mgmtFeeExpense: '5000',
  partnershipExpense: '5100',
}

// POST — compute (and optionally post) a period allocation or period close.
// Body: { action, entryDate, post?, ...action-specific }
//   management_fee: { annualRate, periodFraction, overrides?: { [lpEntityId]: { rateOverride?, exempt? } } }
//   expense:        { amount }
//   gain:           { amount }
//   distribution:   { perLp: { [lpEntityId]: amount } }
//   carry:          { perLp: { [lpEntityId]: amount } }
//   close_period:   {}
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

  const codes = await accountIdByCode(admin, gate.fundId)
  const need = (code: string) => {
    const id = codes.get(code)
    if (!id) throw new Error(`Missing account ${code} — seed the chart of accounts first`)
    return id
  }
  const base = { fundId: gate.fundId, entryDate, memo: body.memo }

  let entry
  try {
    if (action === 'close_period') {
      // Zero every income/expense account into the bridge.
      const { accounts, postings } = await loadPostedLedger(admin, gate.fundId)
      const balances = accountBalances(postings)
      const pnl = accounts
        .filter(a => a.type === 'income' || a.type === 'expense')
        .map(a => ({ accountId: a.id, balance: balances.get(a.id) ?? 0 }))
        .filter(b => b.balance !== 0)
      if (pnl.length === 0) return NextResponse.json({ error: 'Nothing to close — no P&L activity' }, { status: 400 })
      entry = buildPeriodCloseEntry(base, pnl, need(CODE.bridge))
    } else {
      const owners = await loadOwnership(admin, gate.fundId)
      const entityIds =
        action === 'distribution' || action === 'carry'
          ? Object.keys(body.perLp ?? {})
          : owners.map(o => o.lpEntityId)
      const capMap: CapitalAccountMap = await ensureCapitalAccounts(admin, gate.fundId, entityIds)

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
        const accts: BridgeAccounts = { pnlAccountId: need(CODE.mgmtFeeExpense), bridgeAccountId: need(CODE.bridge), offsetAccountId: need(CODE.dueToGp) }
        entry = buildManagementFeeEntry(base, fee, capMap, accts)
      } else if (action === 'expense') {
        const accts: BridgeAccounts = { pnlAccountId: need(CODE.partnershipExpense), bridgeAccountId: need(CODE.bridge), offsetAccountId: need(CODE.cash) }
        entry = buildExpenseEntry(base, Number(body.amount), owners, capMap, accts)
      } else if (action === 'gain') {
        const accts: BridgeAccounts = { pnlAccountId: need(CODE.realizedGains), bridgeAccountId: need(CODE.bridge), offsetAccountId: need(CODE.cash) }
        entry = buildGainEntry(base, Number(body.amount), owners, capMap, accts)
      } else if (action === 'distribution') {
        const perLp = new Map<string, number>(Object.entries(body.perLp ?? {}).map(([k, v]) => [k, Number(v)]))
        entry = buildDistributionEntry(base, perLp, capMap, need(CODE.cash))
      } else if (action === 'carry') {
        const perLp = new Map<string, number>(Object.entries(body.perLp ?? {}).map(([k, v]) => [k, Number(v)]))
        entry = buildCarryEntry(base, perLp, capMap, need(CODE.gpCapital))
      } else {
        return NextResponse.json({ error: `Unknown action ${action}` }, { status: 400 })
      }
    }
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }

  if (!post) return NextResponse.json({ preview: entry })

  const result = await persistEntry(admin, gate.fundId, user.id, entry, 'posted')
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 400 })
  return NextResponse.json({ ok: true, entryId: result.entryId, entry })
}
