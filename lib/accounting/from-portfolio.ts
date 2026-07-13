// Portfolio → ledger: a transaction recorded in the tracker drafts the journal entry
// it implies, for review.
//
// WHY A DRAFT AND NOT A POST. The tracker is where you record *what happened* — a
// round, a mark, a rate move, an exit. The ledger records what the fund *carries*. They
// have to agree, and the per-company tie-out now proves whether they do. But the entry
// a transaction implies isn't always the entry you want (a cost basis may need
// splitting, an exit may have escrow, a period may be closed), so nothing posts itself.
// It lands as a draft in the journal and waits for you.
//
// WHAT IT REFUSES TO GUESS. A row with no `portfolio_group` is company-wide pricing —
// a round the fund didn't participate in still re-prices the position, but in WHICH
// vehicle? Two funds holding the same company both re-price, by different amounts, and
// guessing would post to the wrong books. Those return a reason instead of an entry.
// Same for `round_info`: it is a price signal, not a fund transaction. The mark it
// implies flows through the position's fair value, which the tie-out will surface.
//
// NOTHING HERE MAY THROW INTO THE CALLER. Recording an investment must not fail because
// the ledger hiccuped — the caller reports `LedgerDraftResult` alongside the saved
// transaction and the user decides what to do.

import type { SupabaseClient } from '@supabase/supabase-js'
import { accountIdByCode, persistEntry } from './persist'
import { ensureInvestmentAccounts } from './investments'
import { vehicleIdByName } from './vehicle-id'
import { roundCents } from './ledger'
import type { JournalEntry, Posting } from './types'

const CASH = '1000'
const REALIZED_GAIN = '4000'
const UNREALIZED_INCOME = '4200'
const FX_INCOME = '4300'

export interface LedgerDraftResult {
  /** A draft entry was created and is waiting in the journal. */
  drafted: boolean
  entryId?: string
  /** What kind of entry, for the message shown back. */
  kind?: 'investment' | 'valuation' | 'fx_revaluation' | 'proceeds'
  amount?: number
  vehicle?: string
  /** Why nothing was drafted — always set when `drafted` is false. */
  reason?: string
}

const skip = (reason: string): LedgerDraftResult => ({ drafted: false, reason })

/**
 * Draft the journal entry a portfolio transaction implies. Returns why it didn't,
 * rather than throwing, when the transaction has no ledger meaning or the vehicle
 * isn't on the ledger at all.
 */
export async function draftEntryForTransaction(
  admin: SupabaseClient,
  fundId: string,
  userId: string | null,
  txn: any,
  companyName: string
): Promise<LedgerDraftResult> {
  try {
    const group: string | null = txn?.portfolio_group ?? null
    const companyId: string | null = txn?.company_id ?? null
    const entryDate: string | null = txn?.transaction_date ?? null

    if (!companyId) return skip('No company on the transaction.')
    if (!entryDate) return skip('No transaction date — the ledger needs one to place the entry in a period.')
    if (!group) {
      return skip(
        'This row has no vehicle, so it is company-wide pricing rather than a fund transaction. ' +
        'Tag it to a vehicle if it should hit the books.'
      )
    }
    if (txn.transaction_type === 'round_info') {
      return skip('A round is a price signal, not a fund transaction — no entry to book.')
    }

    // Is this vehicle even on the ledger? If the chart was never seeded, the fund isn't
    // doing accounting here and we say so quietly rather than seeding it behind their back.
    const vehicleId = await vehicleIdByName(admin, fundId, group)
    if (!vehicleId) return skip(`No accounting vehicle named "${group}".`)
    const codes = await accountIdByCode(admin, fundId, group)
    if (codes.size === 0) return skip(`${group} has no chart of accounts — onboard it in Accounting to book entries.`)

    const cashId = codes.get(CASH)
    if (!cashId) return skip(`${group} is missing account 1000 (Cash).`)

    const accts = await ensureInvestmentAccounts(admin, fundId, group, [{ id: companyId, name: companyName }])
    const a = accts.get(companyId)
    if (!a) return skip(`Could not resolve investment accounts for ${companyName}.`)

    const num = (v: any) => {
      const n = Number(v)
      return Number.isFinite(n) ? roundCents(n) : 0
    }

    let entry: JournalEntry | null = null
    let kind: LedgerDraftResult['kind']
    let amount = 0

    // ---- A purchase: cash out, cost on the books. --------------------------
    if (txn.transaction_type === 'investment') {
      const cost = num(txn.investment_cost)
      if (cost === 0) return skip('The investment has no cost — nothing to book.')
      amount = cost
      kind = 'investment'
      entry = {
        fundId,
        entryDate,
        sourceType: 'investment',
        memo: `Investment — ${companyName}${txn.round_name ? ` (${txn.round_name})` : ''}`,
        postings: [
          { accountId: a.costId, amount: cost, currency: 'USD', lpEntityId: null },
          { accountId: cashId, amount: roundCents(-cost), currency: 'USD', lpEntityId: null },
        ],
      }
    }

    // ---- A valuation change: either the company moved, or the currency did. -
    else if (txn.transaction_type === 'unrealized_gain_change') {
      const isFx = txn.valuation_change_source === 'fx'
      const delta = num(isFx ? (txn.fx_value_change ?? txn.unrealized_value_change) : txn.unrealized_value_change)
      if (delta === 0) return skip('The valuation did not change — nothing to book.')

      // The whole reason FX has its own accounts: a rate move is not investment
      // performance, and must never land in 1200/4200.
      const assetId = isFx ? a.fxId : a.unrealizedId
      const incomeCode = isFx ? FX_INCOME : UNREALIZED_INCOME
      const incomeId = codes.get(incomeCode)
      if (!incomeId) {
        return skip(`${group} is missing account ${incomeCode} — re-sync the chart of accounts.`)
      }

      amount = delta
      kind = isFx ? 'fx_revaluation' : 'valuation'
      const rates = txn.prior_fx_rate && txn.fx_rate
        ? ` (${txn.original_currency ?? 'FX'} ${txn.prior_fx_rate} → ${txn.fx_rate})`
        : ''
      entry = {
        fundId,
        entryDate,
        sourceType: isFx ? 'fx_revaluation' : 'valuation',
        memo: isFx
          ? `Foreign currency revaluation — ${companyName}${rates}`
          : `Mark to fair value — ${companyName}${txn.round_name ? ` (${txn.round_name})` : ''}`,
        postings: [
          { accountId: assetId, amount: delta, currency: 'USD', lpEntityId: null },
          { accountId: incomeId, amount: roundCents(-delta), currency: 'USD', lpEntityId: null },
        ],
      }
    }

    // ---- An exit: cash in, cost retired, the difference is a realized gain. -
    else if (txn.transaction_type === 'proceeds') {
      const proceeds = num(txn.proceeds_received)
      const basis = Math.abs(num(txn.cost_basis_exited))
      if (proceeds === 0 && basis === 0) return skip('The exit has neither proceeds nor cost basis — nothing to book.')

      const gainId = codes.get(REALIZED_GAIN)
      if (!gainId) return skip(`${group} is missing account ${REALIZED_GAIN} (Realized gains).`)

      // The gain is the plug, so the entry balances whatever the two inputs are.
      const gain = roundCents(proceeds - basis)
      amount = proceeds
      kind = 'proceeds'
      const postings: Posting[] = [
        { accountId: cashId, amount: proceeds, currency: 'USD', lpEntityId: null },
        { accountId: a.costId, amount: roundCents(-basis), currency: 'USD', lpEntityId: null },
      ]
      if (gain !== 0) postings.push({ accountId: gainId, amount: roundCents(-gain), currency: 'USD', lpEntityId: null })
      entry = {
        fundId,
        entryDate,
        sourceType: 'realized_gain',
        memo: `Exit — ${companyName}${txn.round_name ? ` (${txn.round_name})` : ''}`,
        postings,
      }
    }

    if (!entry) return skip(`No ledger entry is implied by a "${txn.transaction_type}" row.`)

    // Draft, never post. persistEntry still refuses a closed period — which is the right
    // answer, and worth surfacing rather than swallowing.
    const result = await persistEntry(admin, fundId, group, userId, entry, 'draft')
    if ('error' in result) return skip(result.error)

    return { drafted: true, entryId: result.entryId, kind, amount, vehicle: group }
  } catch (e) {
    // The portfolio write already succeeded. A ledger failure must not undo it.
    return skip(e instanceof Error ? e.message : 'Could not draft a journal entry.')
  }
}
