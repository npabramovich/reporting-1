// Carry PAID per recipient — the carry equivalent of the CapitalPosting[] seam. A vehicle keeps
// exactly one producer: the ledger (carry_distribution postings on the associate's own books) or
// the tracking register (carry_payments). One resolver so callers stop branching on the mode.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { CapitalPosting } from './capital-account'
import type { CapitalSource } from './capital-source'
import { roundCents } from './ledger'

export interface CarryPayment {
  id: string
  lpEntityId: string
  date: string
  amount: number
  memo: string | null
  possibleEntryIds: string[]
  journalEntryId: string | null
}

export async function resolveCarryPaid(
  admin: SupabaseClient,
  opts: { source: CapitalSource; asOf?: string; ownPostings: CapitalPosting[]; fundId: string; vehicleId: string },
): Promise<{ paidByLp: Map<string, number>; payments: CarryPayment[]; unresolvedLpIds: Set<string> }> {
  const paidByLp = new Map<string, number>()
  const payments: CarryPayment[] = []
  const unresolvedLpIds = new Set<string>()

  for (const p of opts.ownPostings) {
    if (opts.asOf && p.entryDate && p.entryDate > opts.asOf) continue
    if (!p.lpEntityId || p.sourceType !== 'carry_distribution') continue
    paidByLp.set(p.lpEntityId, roundCents((paidByLp.get(p.lpEntityId) ?? 0) + p.amount))
  }
  const { data: rows, error } = await admin.from('carry_payments' as any)
    .select('id, lp_entity_id, paid_date, amount, memo, journal_entry_id, separate_from_ledger')
    .eq('fund_id', opts.fundId).eq('vehicle_id', opts.vehicleId).order('paid_date', { ascending: false })
  if (error) throw error
  for (const r of (rows as any[]) ?? []) {
    if (opts.asOf && r.paid_date > opts.asOf) continue
    const represented = r.journal_entry_id && opts.ownPostings.some(p => p.entryId === r.journal_entry_id && p.lpEntityId === r.lp_entity_id && p.sourceType === 'carry_distribution')
    const candidates = new Map<string, number>()
    for (const p of opts.ownPostings) if (p.entryId && p.lpEntityId === r.lp_entity_id && p.sourceType === 'carry_distribution' && p.entryDate === r.paid_date) candidates.set(p.entryId, (candidates.get(p.entryId) ?? 0) + p.amount)
    const possibleEntryIds = !r.journal_entry_id && !r.separate_from_ledger ? Array.from(candidates).filter(([, amount]) => Math.abs(amount - Number(r.amount)) < 0.005).map(([id]) => id) : []
    if (possibleEntryIds.length) unresolvedLpIds.add(r.lp_entity_id)
    if (!represented) paidByLp.set(r.lp_entity_id, roundCents((paidByLp.get(r.lp_entity_id) ?? 0) + Number(r.amount)))
    payments.push({ id: r.id, lpEntityId: r.lp_entity_id, date: r.paid_date, amount: Number(r.amount), memo: r.memo ?? null, journalEntryId: r.journal_entry_id ?? null, possibleEntryIds })
  }
  return { paidByLp, payments, unresolvedLpIds }
}
