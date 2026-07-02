// Server-side persistence helpers shared by the allocation and opening-balance
// routes: resolve accounts, create per-LP capital accounts on demand, and write
// a balanced entry with its postings (rolling back the header if postings fail).

import type { SupabaseClient } from '@supabase/supabase-js'
import { lpCapitalCode } from './chart'
import { assertBalanced } from './ledger'
import type { JournalEntry } from './types'

/** code → account_id for the fund's chart. */
export async function accountIdByCode(admin: SupabaseClient, fundId: string): Promise<Map<string, string>> {
  const { data } = await admin.from('chart_of_accounts' as any).select('id, code').eq('fund_id', fundId)
  return new Map(((data as any[]) ?? []).map(a => [a.code as string, a.id as string]))
}

/** Ensure a per-LP capital account exists for each entity, creating any missing. */
export async function ensureCapitalAccounts(
  admin: SupabaseClient,
  fundId: string,
  entityIds: string[]
): Promise<Map<string, string>> {
  const { data: existing } = await admin
    .from('chart_of_accounts' as any)
    .select('id, lp_entity_id')
    .eq('fund_id', fundId)
    .not('lp_entity_id', 'is', null)
  const map = new Map<string, string>(((existing as any[]) ?? []).map(a => [a.lp_entity_id as string, a.id as string]))

  const missing = Array.from(new Set(entityIds)).filter(id => !map.has(id))
  if (missing.length > 0) {
    const { data: ents } = await admin.from('lp_entities' as any).select('id, entity_name').eq('fund_id', fundId)
    const name = new Map<string, string>(((ents as any[]) ?? []).map(e => [e.id as string, e.entity_name as string]))
    const rows = missing.map(id => ({
      fund_id: fundId,
      code: lpCapitalCode(id),
      name: `Partners' capital — ${name.get(id) ?? id}`,
      type: 'equity',
      subtype: 'lp_capital',
      lp_entity_id: id,
    }))
    const { data: created } = await admin.from('chart_of_accounts' as any).insert(rows).select('id, lp_entity_id')
    for (const a of ((created as any[]) ?? [])) map.set(a.lp_entity_id, a.id)
  }
  return map
}

/** Write a balanced entry and its postings. Returns the new entry id or an error string. */
export async function persistEntry(
  admin: SupabaseClient,
  fundId: string,
  userId: string | null,
  entry: JournalEntry,
  status: 'draft' | 'posted' = 'posted'
): Promise<{ entryId: string } | { error: string }> {
  try {
    assertBalanced(entry)
  } catch (e) {
    return { error: (e as Error).message }
  }

  const { data: created, error: entryErr } = await admin
    .from('journal_entries' as any)
    .insert({
      fund_id: fundId,
      entry_date: entry.entryDate,
      memo: entry.memo ?? null,
      source_type: entry.sourceType ?? 'manual',
      status,
      created_by: userId,
      posted_at: status === 'posted' ? new Date().toISOString() : null,
    })
    .select('id')
    .single()
  if (entryErr) return { error: entryErr.message }

  const entryId = (created as any).id
  const { error: postErr } = await admin.from('journal_postings' as any).insert(
    entry.postings.map(p => ({
      fund_id: fundId,
      journal_entry_id: entryId,
      account_id: p.accountId,
      amount: p.amount,
      currency: p.currency,
      lp_entity_id: p.lpEntityId ?? null,
    }))
  )
  if (postErr) {
    await admin.from('journal_entries' as any).delete().eq('id', entryId).eq('fund_id', fundId)
    return { error: postErr.message }
  }

  return { entryId }
}
