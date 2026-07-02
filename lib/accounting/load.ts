// Server-side loaders that adapt DB rows into the pure-logic inputs. Kept out of
// the route files so capital-accounts, reconciliation, and statements all derive
// from the same posted-ledger snapshot.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Account, AccountType, Posting } from './types'
import type { CapitalPosting } from './capital-account'

export interface LoadedLedger {
  accounts: Account[]
  /** All postings on posted entries, as pure-logic Postings. */
  postings: Posting[]
  /** Postings carrying an lp_entity_id, tagged with their entry source_type. */
  capitalPostings: CapitalPosting[]
}

/**
 * Load the fund's chart of accounts and every posting on a POSTED journal entry
 * (drafts and voids excluded — they never affect derived statements).
 */
export async function loadPostedLedger(
  admin: SupabaseClient,
  fundId: string
): Promise<LoadedLedger> {
  const [{ data: acctRows }, { data: entryRows }, { data: postingRows }] = await Promise.all([
    admin.from('chart_of_accounts' as any).select('id, code, name, type, subtype, lp_entity_id').eq('fund_id', fundId),
    admin.from('journal_entries' as any).select('id, source_type, status').eq('fund_id', fundId).eq('status', 'posted'),
    admin.from('journal_postings' as any).select('journal_entry_id, account_id, amount, currency, lp_entity_id').eq('fund_id', fundId),
  ])

  const accounts: Account[] = ((acctRows as any[]) ?? []).map(a => ({
    id: a.id,
    fundId,
    code: a.code,
    name: a.name,
    type: a.type as AccountType,
    subtype: a.subtype ?? null,
    lpEntityId: a.lp_entity_id ?? null,
  }))

  const sourceByEntry = new Map<string, string | null>(
    ((entryRows as any[]) ?? []).map(e => [e.id as string, (e.source_type ?? null) as string | null])
  )

  const postings: Posting[] = []
  const capitalPostings: CapitalPosting[] = []
  for (const p of ((postingRows as any[]) ?? [])) {
    // Only postings whose entry is posted (source map only holds posted entries).
    if (!sourceByEntry.has(p.journal_entry_id)) continue
    const amount = Number(p.amount)
    postings.push({
      accountId: p.account_id,
      amount,
      currency: p.currency ?? 'USD',
      lpEntityId: p.lp_entity_id ?? null,
    })
    if (p.lp_entity_id) {
      capitalPostings.push({
        lpEntityId: p.lp_entity_id,
        amount,
        sourceType: sourceByEntry.get(p.journal_entry_id) ?? null,
      })
    }
  }

  return { accounts, postings, capitalPostings }
}

/** Names for LP entities, for display in capital accounts / reconciliation. */
export async function loadEntityNames(
  admin: SupabaseClient,
  fundId: string
): Promise<Map<string, string>> {
  const { data } = await admin
    .from('lp_entities' as any)
    .select('id, entity_name')
    .eq('fund_id', fundId)
  const out = new Map<string, string>()
  for (const e of ((data as any[]) ?? [])) out.set(e.id, e.entity_name ?? e.id)
  return out
}

/**
 * Committed capital per LP entity (summed across portfolio groups) — the
 * pro-rata basis for the allocation engine and opening balances.
 */
export async function loadOwnership(
  admin: SupabaseClient,
  fundId: string
): Promise<{ lpEntityId: string; commitment: number }[]> {
  const { data } = await admin
    .from('lp_investments' as any)
    .select('entity_id, commitment')
    .eq('fund_id', fundId)
  const byEntity = new Map<string, number>()
  for (const row of ((data as any[]) ?? [])) {
    byEntity.set(row.entity_id, (byEntity.get(row.entity_id) ?? 0) + Number(row.commitment ?? 0))
  }
  return Array.from(byEntity.entries()).map(([lpEntityId, commitment]) => ({ lpEntityId, commitment }))
}
