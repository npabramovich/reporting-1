// Shared bank-import logic used by the REST route and the agent tool, so humans
// and agents ingest through the identical path: parse → dedup → stage → draft.

import type { SupabaseClient } from '@supabase/supabase-js'
import { accountIdByCode, persistEntry } from './persist'
import { parseTransactionsCsv, dedupHash, suggestCategory, bankEntryPostings } from './bank'
import type { JournalEntry } from './types'

export interface ImportResult {
  imported: number
  skipped: number
  errors: string[]
}

export async function importBankTransactions(
  admin: SupabaseClient,
  fundId: string,
  userId: string | null,
  csv: string,
  source = 'csv'
): Promise<ImportResult | { error: string; errors?: string[] }> {
  const { rows, errors } = parseTransactionsCsv((csv ?? '').toString())
  if (rows.length === 0) return { error: errors[0] ?? 'No transactions found', errors }

  const codes = await accountIdByCode(admin, fundId)
  const cashId = codes.get('1000')
  if (!cashId) return { error: 'Seed the chart of accounts first' }

  const { data: existing } = await admin.from('bank_transactions' as any).select('dedup_hash').eq('fund_id', fundId)
  const seen = new Set(((existing as any[]) ?? []).map(r => r.dedup_hash))

  let imported = 0
  let skipped = 0

  for (const row of rows) {
    const hash = dedupHash(row)
    if (seen.has(hash)) { skipped++; continue }
    seen.add(hash)

    const cat = suggestCategory(row)
    const otherId = codes.get(cat.accountCode) ?? cashId
    const entry: JournalEntry = {
      fundId,
      entryDate: row.date,
      memo: row.description || cat.label,
      sourceType: cat.sourceType,
      postings: bankEntryPostings(row.amount, cashId, otherId),
    }
    const result = await persistEntry(admin, fundId, userId, entry, 'draft')
    if ('error' in result) { errors.push(`${row.date} ${row.description}: ${result.error}`); continue }

    const { error: insErr } = await admin.from('bank_transactions' as any).insert({
      fund_id: fundId,
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
    if (insErr) { errors.push(`${row.date}: ${insErr.message}`); continue }
    imported++
  }

  return { imported, skipped, errors }
}
