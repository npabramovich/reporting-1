// Shared bank-import logic used by the REST route and the agent tool, so humans
// and agents ingest through the identical path: parse → dedup → stage → draft.

import type { SupabaseClient } from '@supabase/supabase-js'
import { accountIdByCode, persistEntry } from './persist'
import { vehicleIdByName } from './vehicle-id'
import { parseTransactionsCsv, dedupHash, legacyDedupHash, suggestCategory, bankEntryPostings } from './bank'
import type { JournalEntry } from './types'
import { vendorResolver } from './vendors'
import { clearQuickBooksMatch, loadQuickBooksCashEntries, quickBooksCandidates, quickBooksClaimHash, quickBooksAlreadyClaimed, readAll } from './bank-quickbooks-match'

export interface ImportResult {
  imported: number
  skipped: number
  matched: number
  needsReview: number
  /** Which rows were skipped as duplicates, and why — so "12 skipped" is auditable rather
   *  than indistinguishable from "12 transactions silently lost". */
  skippedRows: string[]
  errors: string[]
}

export async function importBankTransactions(
  admin: SupabaseClient,
  fundId: string,
  group: string,
  userId: string | null,
  csv: string,
  source = 'csv'
): Promise<ImportResult | { error: string; errors?: string[] }> {
  const { rows, errors } = parseTransactionsCsv((csv ?? '').toString())
  if (rows.length === 0) return { error: errors[0] ?? 'No transactions found', errors }

  const codes = await accountIdByCode(admin, fundId, group)
  const cashId = codes.get('1000')
  if (!cashId) return { error: 'Seed the chart of accounts first' }
  // Counterparties become vendors as they arrive, so the 1099 worksheet sees bank-fed spend too.
  const resolveVendor = vendorResolver(admin, fundId)

  const vehicleId = await vehicleIdByName(admin, fundId, group)
  if (!vehicleId) return { error: 'Unknown vehicle' }
  let existing: any[]
  let qbEntries: Awaited<ReturnType<typeof loadQuickBooksCashEntries>>
  try {
    existing = await readAll<any>((from, to) => admin.from('bank_transactions' as any)
      .select('dedup_hash, journal_entry_id, raw').eq('fund_id', fundId).eq('vehicle_id', vehicleId).order('id').range(from, to))
    qbEntries = await loadQuickBooksCashEntries(admin, fundId, vehicleId, cashId, rows.map(r => r.date))
  } catch (e) { return { error: `Could not check for existing transactions: ${(e as Error).message}` } }
  const seen = new Set(existing.flatMap(r => [r.dedup_hash, r.raw?.bankImportHash].filter(Boolean)))
  const claimed = new Set<string>()
  // A single cash movement cannot explain two rows in the same bank file.
  const demand = new Map<string, number>()
  for (const row of rows) {
    for (const e of quickBooksCandidates(row, qbEntries)) {
      const key = quickBooksClaimHash(e.id, e.amount)
      demand.set(key, (demand.get(key) ?? 0) + 1)
    }
  }
  let matched = 0
  let needsReview = 0

  let imported = 0
  let skipped = 0
  /** WHICH rows were skipped, not just how many. A silent "12 skipped" is indistinguishable
   *  from "12 transactions we lost", and the user can't tell which without the detail. */
  const skippedRows: string[] = []

  // How many times we've already seen this exact (date, amount, description) in THIS file.
  // Two identical wire fees on one day are two transactions, not one — see dedupHash.
  const occurrences = new Map<string, number>()

  for (const row of rows) {
    const base = dedupHash(row, 0)
    const n = occurrences.get(base) ?? 0
    occurrences.set(base, n + 1)

    const hash = dedupHash(row, n)
    // Match against the legacy 32-bit hash too, so a file imported before the hash changed is
    // still recognised as already-imported rather than duplicated wholesale.
    const legacy = n === 0 ? legacyDedupHash(row) : null

    if (seen.has(hash) || (legacy && seen.has(legacy))) {
      skipped++
      skippedRows.push(`${row.date} ${row.description || ''} ${row.amount.toFixed(2)} — already imported`)
      continue
    }
    const candidates = quickBooksCandidates(row, qbEntries)
    const confident = clearQuickBooksMatch(row, candidates)
    const claimKey = confident ? quickBooksClaimHash(confident.id, confident.amount) : ''
    const match = confident && !claimed.has(claimKey) && !quickBooksAlreadyClaimed(confident, existing) && demand.get(claimKey) === 1 ? confident : null
    if (candidates.length) {
      const { error } = await admin.from('bank_transactions' as any).insert({
        fund_id: fundId, portfolio_group: group, vehicle_id: vehicleId, source,
        dedup_hash: match ? quickBooksClaimHash(match.id, match.amount) : hash,
        txn_date: row.date, amount: row.amount, description: row.description,
        counterparty: row.counterparty ?? null, status: match ? 'reconciled' : 'unmatched',
        journal_entry_id: match?.id ?? null, imported_by: userId,
        raw: { ...row, bankImportHash: hash, quickbooksReview: true, quickbooksCashAmount: match?.amount ?? null },
      })
      if (error) { errors.push(`${row.date} ${row.description}: ${error.message}`); continue }
      seen.add(hash)
      imported++
      if (match) { matched++; claimed.add(claimKey) } else needsReview++
      continue
    }

    const cat = suggestCategory(row)
    const otherId = codes.get(cat.accountCode) ?? cashId
    const entry: JournalEntry = {
      fundId,
      entryDate: row.date,
      memo: row.description || cat.label,
      sourceType: cat.sourceType,
      // The feed's counterparty becomes the entry's vendor, created if new — so "what did we
      // pay this vendor" and the 1099 worksheet see bank-fed payments without anyone retyping.
      vendorId: await resolveVendor(row.counterparty),
      postings: bankEntryPostings(row.amount, cashId, otherId),
    }
    const result = await persistEntry(admin, fundId, group, userId, entry, 'draft')
    if ('error' in result) { errors.push(`${row.date} ${row.description}: ${result.error}`); continue }

    const { error: insErr } = await admin.from('bank_transactions' as any).insert({
      fund_id: fundId,
      portfolio_group: group,
      vehicle_id: vehicleId,
      source,
      dedup_hash: hash,
      txn_date: row.date,
      amount: row.amount,
      description: row.description,
      counterparty: row.counterparty ?? null,
      status: 'drafted',
      journal_entry_id: result.entryId,
      suggested_account_code: cat.accountCode,
      imported_by: userId,
      raw: row,
    })
    if (insErr) {
      // The entry exists but its bank transaction doesn't — most often because a concurrent
      // import (a double-click) already claimed this hash via the unique constraint. Without
      // this cleanup the draft entry survives as an ORPHAN: unlinked, invisible on the bank
      // page, and postable from the Journal, which would DOUBLE-POST the transaction — once
      // through the orphan and once through the row that won the race.
      await admin.from('journal_entries' as any)
        .delete()
        .eq('id', result.entryId)
        .eq('fund_id', fundId)
      errors.push(`${row.date}: ${insErr.message}`)
      continue
    }
    seen.add(hash)
    imported++
  }

  return { imported, skipped, matched, needsReview, skippedRows, errors }
}
