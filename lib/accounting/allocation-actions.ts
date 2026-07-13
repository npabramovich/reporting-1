// Entry-building for the agent/MCP `allocation` tool. Builds (but does not persist)
// the balanced entry for an action; the caller decides preview vs post.
//
// NOTE — despite the name, these actions no longer ALLOCATE to partners' capital.
// Booking an expense, fee, gain, or mark posts P&L only; allocation to capital
// accounts happens in exactly one place, the period close (`./close.ts`). The two
// used to both allocate, which would have double-counted. Distributions and carry
// still move capital directly — they are capital movements, not P&L.

import type { SupabaseClient } from '@supabase/supabase-js'
import { loadOwnership, loadPostedLedger } from './load'
import { accountIdByCode, ensureCapitalAccounts } from './persist'
import { computeManagementFee } from './fees'
import { accountBalances, roundCents } from './ledger'
import {
  buildManagementFeeEntry,
  buildExpenseEntry,
  buildGainEntry,
  buildDistributionEntry,
  buildCarryEntry,
  buildPeriodCloseEntry,
  buildRevaluationEntry,
  type CapitalAccountMap,
  type PnlAccounts,
} from './entries'
import type { JournalEntry } from './types'

export const CODE = {
  cash: '1000',
  investmentCost: '1100',
  unrealizedAsset: '1200',
  dueToGp: '2100',
  gpCapital: '3000',
  bridge: '3200',
  realizedGains: '4000',
  unrealizedIncome: '4200',
  mgmtFeeExpense: '5000',
  partnershipExpense: '5100',
}

export interface AllocationBody {
  action: string
  entryDate: string
  memo?: string
  annualRate?: number
  periodFraction?: number
  amount?: number
  fairValue?: number
  overrides?: Record<string, { rateOverride?: number; exempt?: boolean }>
  perLp?: Record<string, number>
}

export async function buildAllocationEntry(
  admin: SupabaseClient,
  fundId: string,
  group: string,
  body: AllocationBody
): Promise<{ entry: JournalEntry } | { error: string }> {
  const { action, entryDate } = body
  if (!action || !entryDate) return { error: 'action and entryDate are required' }

  const codes = await accountIdByCode(admin, fundId, group)
  const need = (code: string): string => {
    const id = codes.get(code)
    if (!id) throw new Error(`Missing account ${code} — seed the chart of accounts first`)
    return id
  }
  const base = { fundId, entryDate, memo: body.memo }

  try {
    if (action === 'close_period') {
      const { accounts, postings } = await loadPostedLedger(admin, fundId, group)
      const balances = accountBalances(postings)
      const pnl = accounts
        .filter(a => a.type === 'income' || a.type === 'expense')
        .map(a => ({ accountId: a.id, balance: balances.get(a.id) ?? 0 }))
        .filter(b => b.balance !== 0)
      if (pnl.length === 0) return { error: 'Nothing to close — no P&L activity' }
      return { entry: buildPeriodCloseEntry(base, pnl, need(CODE.bridge)) }
    }

    if (action === 'management_fee') {
      const owners = await loadOwnership(admin, fundId, group)
      const overrides = body.overrides ?? {}
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
      const accts: PnlAccounts = { pnlAccountId: need(CODE.mgmtFeeExpense), offsetAccountId: need(CODE.dueToGp) }
      return { entry: buildManagementFeeEntry(base, fee, accts) }
    }
    if (action === 'expense') {
      const accts: PnlAccounts = { pnlAccountId: need(CODE.partnershipExpense), offsetAccountId: need(CODE.cash) }
      return { entry: buildExpenseEntry(base, Number(body.amount), accts) }
    }
    if (action === 'gain') {
      const accts: PnlAccounts = { pnlAccountId: need(CODE.realizedGains), offsetAccountId: need(CODE.cash) }
      return { entry: buildGainEntry(base, Number(body.amount), accts) }
    }
    if (action === 'revalue') {
      // Mark the investment to a new fair value. P&L only — the close allocates it.
      const { accounts, postings } = await loadPostedLedger(admin, fundId, group)
      const bal = accountBalances(postings)
      const byCode = new Map(accounts.map(a => [a.code, a.id]))
      const idFor = (code: string) => byCode.get(code)
      const carrying = roundCents(
        (idFor(CODE.investmentCost) ? bal.get(idFor(CODE.investmentCost)!) ?? 0 : 0) +
        (idFor(CODE.unrealizedAsset) ? bal.get(idFor(CODE.unrealizedAsset)!) ?? 0 : 0)
      )
      const delta = roundCents(Number(body.fairValue) - carrying)
      if (delta === 0) return { error: 'Fair value equals the current carrying value — nothing to revalue' }
      return { entry: buildRevaluationEntry(base, delta, { unrealizedAssetId: need(CODE.unrealizedAsset), incomeId: need(CODE.unrealizedIncome) }) }
    }

    // Distributions and carry DO move capital directly — they aren't P&L.
    const capMap: CapitalAccountMap = await ensureCapitalAccounts(admin, fundId, group, Object.keys(body.perLp ?? {}))

    if (action === 'distribution') {
      const perLp = new Map<string, number>(Object.entries(body.perLp ?? {}).map(([k, v]) => [k, Number(v)]))
      return { entry: buildDistributionEntry(base, perLp, capMap, need(CODE.cash)) }
    }
    if (action === 'carry') {
      const perLp = new Map<string, number>(Object.entries(body.perLp ?? {}).map(([k, v]) => [k, Number(v)]))
      return { entry: buildCarryEntry(base, perLp, capMap, need(CODE.gpCapital)) }
    }
    return { error: `Unknown action ${action}` }
  } catch (e) {
    return { error: (e as Error).message }
  }
}
