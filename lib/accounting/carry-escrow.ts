// Carried interest held in a third-party escrow (carry_escrow_events). An LPA can hold back part of
// the carry paid until the fund is past a clawback risk; the escrow sits outside the fund's books,
// so the ILPA Reporting Template's "Amount Held in Escrow" balance is read from this register.
//
// A deposit is carry paid into the escrow; a release is carry paid out of it, to the recipients or
// back to the fund on a clawback.

import type { SupabaseClient } from '@supabase/supabase-js'
import { roundCents } from '@portfolio/fund-engine'
import { vehicleIdByName } from './vehicle-id'

export const ESCROW_KINDS = ['deposit', 'release'] as const
export type EscrowKind = (typeof ESCROW_KINDS)[number]

export interface EscrowEvent {
  id: string
  /** YYYY-MM-DD. */
  date: string
  kind: EscrowKind
  amount: number
  memo: string | null
}

export interface EscrowEventInput {
  date: string
  kind: EscrowKind
  amount: number
  memo: string | null
}

const DATE = /^\d{4}-\d{2}-\d{2}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Check one event without touching the database. */
export function parseEscrowEventInput(raw: unknown): { ok: true; value: EscrowEventInput } | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: 'The escrow entry must be an object.' }
  const e = raw as Record<string, unknown>
  if (typeof e.date !== 'string' || !DATE.test(e.date)) return { error: 'The escrow entry needs a date (YYYY-MM-DD).' }
  if (!ESCROW_KINDS.includes(e.kind as EscrowKind)) return { error: 'The escrow entry is a deposit or a release.' }
  const amount = Number(e.amount)
  if (!(amount > 0) || !Number.isFinite(amount)) return { error: 'The escrow entry needs an amount above zero.' }
  const memo = typeof e.memo === 'string' && e.memo.trim() ? e.memo.trim().slice(0, 500) : null
  return { ok: true, value: { date: e.date, kind: e.kind as EscrowKind, amount: roundCents(amount), memo } }
}

/** The balance held at the end of `asOf` (every event when absent). */
export function escrowBalance(events: Pick<EscrowEvent, 'date' | 'kind' | 'amount'>[], asOf?: string): number {
  return roundCents(events.filter(e => !asOf || e.date <= asOf).reduce((s, e) => s + (e.kind === 'deposit' ? e.amount : -e.amount), 0))
}

const fromRow = (r: any): EscrowEvent => ({ id: r.id, date: r.event_date, kind: r.kind, amount: Number(r.amount), memo: r.memo ?? null })

export async function loadEscrowEvents(admin: SupabaseClient, fundId: string, group: string): Promise<EscrowEvent[] | { error: string }> {
  const vehicleId = await vehicleIdByName(admin, fundId, group)
  if (!vehicleId) return []
  const { data, error } = await (admin as any).from('carry_escrow_events')
    .select('id, event_date, kind, amount, memo')
    .eq('fund_id', fundId).eq('vehicle_id', vehicleId)
    .order('event_date', { ascending: true })
  if (error) return { error: 'The carry escrow register could not be read.' }
  return ((data as any[]) ?? []).map(fromRow)
}

export async function addEscrowEvent(
  admin: SupabaseClient,
  fundId: string,
  group: string,
  raw: unknown,
  userId: string,
): Promise<{ ok: true; event: EscrowEvent } | { error: string; status: number; dbError?: { message: string } }> {
  const vehicleId = await vehicleIdByName(admin, fundId, group)
  if (!vehicleId) return { error: `Unknown vehicle "${group}".`, status: 400 }
  const parsed = parseEscrowEventInput(raw)
  if ('error' in parsed) return { error: parsed.error, status: 400 }
  const e = parsed.value
  if (e.kind === 'release') {
    // A release cannot take out more than the escrow holds on its date.
    const existing = await loadEscrowEvents(admin, fundId, group)
    if ('error' in existing) return { error: existing.error, status: 500 }
    const held = escrowBalance(existing, e.date)
    if (e.amount > held + 0.005) return { error: `The escrow holds ${held.toFixed(2)} on ${e.date}, so it cannot release ${e.amount.toFixed(2)}.`, status: 400 }
  }
  const { data, error } = await (admin as any).from('carry_escrow_events')
    .insert({ fund_id: fundId, vehicle_id: vehicleId, event_date: e.date, kind: e.kind, amount: e.amount, memo: e.memo, created_by: userId })
    .select('id, event_date, kind, amount, memo')
    .single()
  if (error) return { error: 'The escrow entry could not be saved.', status: 500, dbError: error }
  return { ok: true, event: fromRow(data) }
}

export async function deleteEscrowEvent(
  admin: SupabaseClient,
  fundId: string,
  group: string,
  id: string,
): Promise<{ ok: true } | { error: string; status: number; dbError?: { message: string } }> {
  const vehicleId = await vehicleIdByName(admin, fundId, group)
  if (!vehicleId) return { error: `Unknown vehicle "${group}".`, status: 400 }
  if (!UUID.test(id)) return { error: 'No such escrow entry.', status: 404 }
  const { data, error } = await (admin as any).from('carry_escrow_events')
    .delete().eq('fund_id', fundId).eq('vehicle_id', vehicleId).eq('id', id).select('id')
  if (error) return { error: 'The escrow entry could not be deleted.', status: 500, dbError: error }
  if (!data?.length) return { error: 'No such escrow entry.', status: 404 }
  return { ok: true }
}
