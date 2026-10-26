// Credit facilities: a vehicle's subscription line (or other borrowing) and what moved on it. The
// one read and write path for the register, used by the capital accounts page, the agent tools and
// their staged actions.
//
// A facility is one row (credit_facilities). Each draw, repayment, interest payment or fee is one
// row (credit_facility_events), and each row stands for exactly one entry on the books:
//
//   posted  the register wrote it (buildFacilityEntry): a draw is Dr cash / Cr loan payable, a
//           repayment the reverse, interest and fees Dr interest expense / Cr cash, which
//           persistEntry allocates to the partners like any expense.
//   linked  the entry was already on the books (booked from the bank feed, or by hand), so the
//           row only says which facility it belongs to and what it was for. Nothing is posted.
//
// A row whose entry has been voided no longer counts, so voiding the entry (with its audit reason)
// is how a posted row is undone; `removeFacilityEvent` then clears it.
//
// What the register adds over the ledger is what the ILPA Performance Template needs: which
// borrowing a movement was on, what a draw paid for, and which call paid a repayment or interest.
// lib/ilpa/performance-load.ts reads it.

import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { roundCents } from './ledger'
import { persistEntry } from './persist'
import { validCapitalDate } from './capital-operation-key'
import { vehicleIdByName } from './vehicle-id'
import { ensureVehicleAccounts } from './provision-accounts'
import { ACTUAL_BOOK } from './books'
import {
  buildFacilityEntry,
  DRAW_PURPOSE_LABEL,
  DRAW_PURPOSES,
  EVENT_TYPE_LABEL,
  FACILITY_EVENT_TYPES,
  FACILITY_KINDS,
  facilityBalance,
  linkedAmount,
  matchRepayments,
  type DrawPurpose,
  type FacilityAccounts,
  type FacilityBalance,
  type FacilityEvent,
  type FacilityEventType,
  type FacilityKind,
  type PurposeMatch,
} from './credit-facility-core'

export * from './credit-facility-core'

export interface Facility {
  id: string
  name: string
  kind: FacilityKind
  lender: string | null
  commitmentAmount: number | null
  openedOn: string | null
  maturesOn: string | null
  rateDescription: string | null
  notes: string | null
}

export interface FacilityWithStatus extends Facility {
  balance: FacilityBalance
  /** What may still be drawn, when the facility's size is recorded. */
  available: number | null
  events: FacilityEvent[]
  match: PurposeMatch
}

export interface FacilityRegister {
  vehicle: string
  vehicleId: string | null
  facilities: Facility[]
  events: FacilityEvent[]
}

const str = (v: unknown, max = 300) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)

/** Every facility on the vehicle and every row on them. A database not yet migrated reads as none. */
export async function loadFacilityRegister(admin: SupabaseClient, fundId: string, group: string): Promise<FacilityRegister> {
  const vehicleId = await vehicleIdByName(admin, fundId, group)
  if (!vehicleId) return { vehicle: group, vehicleId: null, facilities: [], events: [] }
  const [{ data: facRows, error: facErr }, { data: evRows, error: evErr }] = await Promise.all([
    (admin as any).from('credit_facilities')
      .select('id, name, kind, lender, commitment_amount, opened_on, matures_on, rate_description, notes')
      .eq('fund_id', fundId).eq('vehicle_id', vehicleId).order('name', { ascending: true }),
    (admin as any).from('credit_facility_events')
      .select('id, facility_id, event_type, event_date, amount, purpose, call_id, journal_entry_id, entry_origin, memo')
      .eq('fund_id', fundId).eq('vehicle_id', vehicleId).order('event_date', { ascending: true }),
  ])
  if (facErr || evErr) return { vehicle: group, vehicleId, facilities: [], events: [] }
  const raw = (evRows as any[]) ?? []
  const entryIds = raw.map(r => r.journal_entry_id).filter(Boolean)
  const status = new Map<string, string>()
  if (entryIds.length) {
    const { data: entries } = await admin.from('journal_entries' as any).select('id, status').eq('book', ACTUAL_BOOK).in('id', entryIds)
    for (const e of ((entries as any[]) ?? [])) status.set(e.id, e.status)
  }
  const facilities: Facility[] = ((facRows as any[]) ?? []).map(f => ({
    id: f.id,
    name: f.name,
    kind: (FACILITY_KINDS as readonly string[]).includes(f.kind) ? f.kind : 'other',
    lender: f.lender ?? null,
    commitmentAmount: f.commitment_amount == null ? null : roundCents(Number(f.commitment_amount)),
    openedOn: f.opened_on ? String(f.opened_on).slice(0, 10) : null,
    maturesOn: f.matures_on ? String(f.matures_on).slice(0, 10) : null,
    rateDescription: f.rate_description ?? null,
    notes: f.notes ?? null,
  }))
  const events: FacilityEvent[] = raw.map(r => ({
    id: r.id,
    facilityId: r.facility_id,
    type: r.event_type,
    date: String(r.event_date).slice(0, 10),
    amount: roundCents(Number(r.amount)),
    purpose: r.purpose ?? null,
    callId: r.call_id ?? null,
    journalEntryId: r.journal_entry_id ?? null,
    origin: r.entry_origin === 'linked' ? 'linked' : 'posted',
    memo: r.memo ?? null,
    live: !!r.journal_entry_id && status.get(r.journal_entry_id) === 'posted',
  }))
  return { vehicle: group, vehicleId, facilities, events }
}

/** Each facility with its balance, what is left to draw, its rows and their purposes, through `asOf`. */
export function facilitiesWithStatus(register: FacilityRegister, asOf?: string): FacilityWithStatus[] {
  return register.facilities.map(f => {
    const events = register.events.filter(e => e.facilityId === f.id)
    const balance = facilityBalance(events, asOf)
    return {
      ...f,
      balance,
      available: f.commitmentAmount == null ? null : roundCents(Math.max(0, f.commitmentAmount - balance.outstanding)),
      events,
      match: matchRepayments(events, asOf),
    }
  })
}

export async function facilityStatus(admin: SupabaseClient, fundId: string, group: string, asOf?: string) {
  const register = await loadFacilityRegister(admin, fundId, group)
  return { vehicle: group, facilities: facilitiesWithStatus(register, asOf) }
}

// ── Facilities ────────────────────────────────────────────────────────────────

export interface FacilityInput {
  id?: unknown
  name?: unknown
  kind?: unknown
  lender?: unknown
  commitmentAmount?: unknown
  openedOn?: unknown
  maturesOn?: unknown
  rateDescription?: unknown
  notes?: unknown
}

/** Check a facility's fields without touching the database. */
export function parseFacility(body: FacilityInput): { ok: true; value: Omit<Facility, 'id'> } | { error: string } {
  const name = str(body?.name, 120)
  if (!name) return { error: 'Name the facility (for example "Subscription line").' }
  const kind = body?.kind == null || body.kind === '' ? 'subscription' : body.kind
  if (!(FACILITY_KINDS as readonly unknown[]).includes(kind)) return { error: 'The kind is subscription (secured by uncalled commitments), nav or other.' }
  let commitmentAmount: number | null = null
  if (body?.commitmentAmount != null && body.commitmentAmount !== '') {
    commitmentAmount = roundCents(Number(body.commitmentAmount))
    if (!Number.isFinite(commitmentAmount) || commitmentAmount <= 0) return { error: 'The facility size must be more than zero, or left out.' }
  }
  const date = (v: unknown, label: string): string | null | { error: string } => {
    if (v == null || v === '') return null
    return validCapitalDate(v) ? v : { error: `The ${label} date must be YYYY-MM-DD.` }
  }
  const openedOn = date(body?.openedOn, 'opening')
  if (openedOn && typeof openedOn === 'object') return openedOn
  const maturesOn = date(body?.maturesOn, 'maturity')
  if (maturesOn && typeof maturesOn === 'object') return maturesOn
  if (openedOn && maturesOn && maturesOn < openedOn) return { error: 'The facility cannot mature before it opens.' }
  return {
    ok: true,
    value: {
      name,
      kind: kind as FacilityKind,
      lender: str(body?.lender, 200),
      commitmentAmount,
      openedOn: openedOn as string | null,
      maturesOn: maturesOn as string | null,
      rateDescription: str(body?.rateDescription, 300),
      notes: str(body?.notes, 2000),
    },
  }
}

/** Add a facility, or change one (`id`). */
export async function saveFacility(
  admin: SupabaseClient,
  fundId: string,
  group: string,
  userId: string | null,
  body: FacilityInput,
): Promise<{ ok: true; facility: Facility } | { error: string }> {
  const vehicleId = await vehicleIdByName(admin, fundId, group)
  if (!vehicleId) return { error: `Unknown vehicle "${group}".` }
  const parsed = parseFacility(body)
  if ('error' in parsed) return parsed
  const f = parsed.value
  const row = {
    name: f.name,
    kind: f.kind,
    lender: f.lender,
    commitment_amount: f.commitmentAmount,
    opened_on: f.openedOn,
    matures_on: f.maturesOn,
    rate_description: f.rateDescription,
    notes: f.notes,
    updated_at: new Date().toISOString(),
  }
  const id = typeof body?.id === 'string' && body.id ? body.id : null
  const q = id
    ? (admin as any).from('credit_facilities').update(row).eq('fund_id', fundId).eq('vehicle_id', vehicleId).eq('id', id)
    : (admin as any).from('credit_facilities').insert({ ...row, fund_id: fundId, vehicle_id: vehicleId, created_by: userId })
  const { data, error } = await q.select('id').maybeSingle()
  if (error) {
    if ((error as { code?: string }).code === '23505') return { error: `${group} already has a facility named "${f.name}".` }
    return { error: `The facility could not be saved: ${error.message}` }
  }
  if (!data) return { error: `No facility with that id on ${group}.` }
  return { ok: true, facility: { id: (data as any).id, ...f } }
}

/** Remove a facility that has nothing recorded on it. */
export async function removeFacility(admin: SupabaseClient, fundId: string, group: string, id: unknown): Promise<{ ok: true } | { error: string }> {
  if (typeof id !== 'string' || !id) return { error: 'Which facility? Pass its id.' }
  const register = await loadFacilityRegister(admin, fundId, group)
  if (!register.facilities.some(f => f.id === id)) return { error: `No facility with that id on ${group}.` }
  if (register.events.some(e => e.facilityId === id)) return { error: 'This facility has draws or payments recorded. Remove those first.' }
  const { error } = await (admin as any).from('credit_facilities').delete().eq('fund_id', fundId).eq('vehicle_id', register.vehicleId).eq('id', id)
  if (error) return { error: `The facility could not be removed: ${error.message}` }
  return { ok: true }
}

// ── Draws, repayments, interest and fees ──────────────────────────────────────

export interface FacilityEventInput {
  facilityId?: unknown
  type?: unknown
  date?: unknown
  amount?: unknown
  purpose?: unknown
  callId?: unknown
  /** Link this entry, already on the books, instead of posting a new one. */
  entryId?: unknown
  memo?: unknown
}

export interface CheckedFacilityEvent {
  facility: FacilityWithStatus
  type: FacilityEventType
  date: string
  amount: number
  purpose: DrawPurpose | null
  callId: string | null
  link: { entryId: string } | null
  memo: string | null
  /** The facility's outstanding balance after this row, on its date. */
  outstandingAfter: number
}

/** The vehicle's cash, loan payable and interest expense accounts (lowest code of each subtype). */
async function facilityAccounts(admin: SupabaseClient, fundId: string, group: string, vehicleId: string): Promise<FacilityAccounts | { error: string }> {
  await ensureVehicleAccounts(admin, fundId, group)
  const { data } = await admin
    .from('chart_of_accounts' as any)
    .select('id, code, subtype, lp_entity_id')
    .eq('fund_id', fundId)
    .eq('vehicle_id', vehicleId)
    .in('subtype', ['cash', 'loan_payable', 'interest_expense'])
  const pick = (subtype: string) => ((data as any[]) ?? [])
    .filter(a => a.subtype === subtype && !a.lp_entity_id && !String(a.code).includes('-'))
    .sort((a, b) => String(a.code).localeCompare(String(b.code)))[0]?.id as string | undefined
  const cash = pick('cash'), loan = pick('loan_payable'), interest = pick('interest_expense')
  if (!cash || !loan || !interest) {
    const missing = [!cash && 'cash', !loan && 'loan payable', !interest && 'interest expense'].filter(Boolean).join(', ')
    return { error: `The chart is missing a ${missing} account. Add it under the entity's Admin → Chart of accounts.` }
  }
  return { cash, loan, interest }
}

/** Check a row against the facility, its balance and (for a link) the entry, writing nothing. */
export async function checkFacilityEvent(
  admin: SupabaseClient,
  fundId: string,
  group: string,
  input: FacilityEventInput,
): Promise<{ ok: true; value: CheckedFacilityEvent; accounts: FacilityAccounts; vehicleId: string } | { error: string }> {
  const vehicleId = await vehicleIdByName(admin, fundId, group)
  if (!vehicleId) return { error: `Unknown vehicle "${group}".` }
  const type = input?.type
  if (!(FACILITY_EVENT_TYPES as readonly unknown[]).includes(type)) return { error: 'The type is draw, repayment, interest or fee.' }
  const date = input?.date
  if (!validCapitalDate(date)) return { error: 'The date is required (YYYY-MM-DD).' }
  const amount = roundCents(Number(input?.amount))
  if (!Number.isFinite(amount) || amount <= 0) return { error: 'The amount must be more than zero.' }

  const register = await loadFacilityRegister(admin, fundId, group)
  const facilityId = input?.facilityId
  const target = typeof facilityId === 'string' && facilityId
    ? register.facilities.find(f => f.id === facilityId)
    : register.facilities.length === 1 ? register.facilities[0] : undefined
  if (!target) {
    return { error: register.facilities.length === 0
      ? `${group} has no credit facility yet. Add one first.`
      : 'Which facility? Pass its id (the facility list shows them).' }
  }
  const facility = facilitiesWithStatus({ ...register, facilities: [target] }, date)[0]

  let purpose: DrawPurpose | null = null
  if (type === 'draw') {
    const p = input?.purpose == null || input.purpose === '' ? 'investment' : input.purpose
    if (!(DRAW_PURPOSES as readonly unknown[]).includes(p)) return { error: 'A draw pays for investment, management_fee, fund_expense or working_capital.' }
    purpose = p as DrawPurpose
  }
  if (target.openedOn && date < target.openedOn) return { error: `${target.name} opened on ${target.openedOn}.` }

  let outstandingAfter = facility.balance.outstanding
  if (type === 'draw') {
    outstandingAfter = roundCents(outstandingAfter + amount)
    if (target.commitmentAmount != null && outstandingAfter > target.commitmentAmount + 0.005) {
      return { error: `That would take ${target.name} to ${outstandingAfter.toLocaleString('en-US')} drawn, over its ${target.commitmentAmount.toLocaleString('en-US')} size.` }
    }
  }
  if (type === 'repayment') {
    if (amount > facility.balance.outstanding + 0.005) {
      return { error: `Only ${facility.balance.outstanding.toLocaleString('en-US')} is drawn on ${target.name} at ${date}, so ${amount.toLocaleString('en-US')} cannot be repaid.` }
    }
    outstandingAfter = roundCents(outstandingAfter - amount)
  }

  let callId: string | null = null
  if (input?.callId != null && input.callId !== '') {
    if (type === 'draw') return { error: 'A draw is not paid by a call. Link the call to the repayment or interest it paid.' }
    const { data: call } = await admin.from('capital_calls' as any).select('id, status').eq('fund_id', fundId).eq('vehicle_id', vehicleId).eq('id', String(input.callId)).maybeSingle()
    if (!call || (call as any).status === 'draft') return { error: 'That capital call is not an issued call on this vehicle.' }
    callId = (call as any).id
  }

  const accounts = await facilityAccounts(admin, fundId, group, vehicleId)
  if ('error' in accounts) return accounts

  let link: { entryId: string } | null = null
  if (input?.entryId != null && input.entryId !== '') {
    const entryId = String(input.entryId)
    if (register.events.some(e => e.journalEntryId === entryId)) return { error: 'That entry is already on the register.' }
    const { data: entry } = await admin.from('journal_entries' as any)
      .select('id, status, entry_date, vehicle_id').eq('fund_id', fundId).eq('book', ACTUAL_BOOK).eq('id', entryId).maybeSingle()
    if (!entry || (entry as any).vehicle_id !== vehicleId) return { error: `No entry with that id on ${group}.` }
    if ((entry as any).status !== 'posted') return { error: 'Only a posted entry can be linked.' }
    if (String((entry as any).entry_date).slice(0, 10) !== date) return { error: `That entry is dated ${String((entry as any).entry_date).slice(0, 10)}, not ${date}.` }
    const { data: postings } = await admin.from('journal_postings' as any).select('account_id, amount').eq('book', ACTUAL_BOOK).eq('fund_id', fundId).eq('journal_entry_id', entryId)
    const moved = linkedAmount(type as FacilityEventType, ((postings as any[]) ?? []).map(p => ({ accountId: p.account_id, amount: Number(p.amount) })), accounts)
    if (Math.abs(moved - amount) > 0.005) {
      const what = type === 'draw' ? 'credit the loan payable account' : type === 'repayment' ? 'debit the loan payable account' : 'debit the interest expense account'
      return { error: `A ${EVENT_TYPE_LABEL[type as FacilityEventType].toLowerCase()} entry must ${what} by ${amount.toLocaleString('en-US')}; that one moves it by ${moved.toLocaleString('en-US')}.` }
    }
    link = { entryId }
  }

  return {
    ok: true,
    vehicleId,
    accounts,
    value: { facility, type: type as FacilityEventType, date, amount, purpose, callId, link, memo: str(input?.memo, 500), outstandingAfter },
  }
}

/** Record a row: post its entry (or link the one given), then write the register row. */
export async function recordFacilityEvent(
  admin: SupabaseClient,
  fundId: string,
  group: string,
  userId: string | null,
  input: FacilityEventInput,
): Promise<{ ok: true; id: string; entryId: string; checked: CheckedFacilityEvent } | { error: string }> {
  const checked = await checkFacilityEvent(admin, fundId, group, input)
  if ('error' in checked) return checked
  const c = checked.value
  const id = randomUUID()

  let entryId: string
  if (c.link) {
    entryId = c.link.entryId
  } else {
    const what = c.type === 'draw' ? `draw for ${DRAW_PURPOSE_LABEL[c.purpose ?? 'investment'].toLowerCase()}` : EVENT_TYPE_LABEL[c.type].toLowerCase()
    const memo = `${c.facility.name}: ${what}${c.memo ? ` — ${c.memo}` : ''}`
    const entry = buildFacilityEntry({ fundId, eventId: id, type: c.type, date: c.date, amount: c.amount, memo }, checked.accounts)
    const result = await persistEntry(admin, fundId, group, userId, entry, 'posted')
    if ('error' in result) return { error: result.error }
    entryId = result.entryId
  }

  const { error } = await (admin as any).from('credit_facility_events').insert({
    id,
    fund_id: fundId,
    vehicle_id: checked.vehicleId,
    facility_id: c.facility.id,
    event_type: c.type,
    event_date: c.date,
    amount: c.amount,
    purpose: c.purpose,
    call_id: c.callId,
    journal_entry_id: entryId,
    entry_origin: c.link ? 'linked' : 'posted',
    memo: c.memo,
    created_by: userId,
  })
  if (error) {
    return { error: c.link
      ? `The row could not be written: ${error.message}`
      : `The entry was posted (${entryId}) but the register row could not be written: ${error.message}. Void the entry and try again.` }
  }
  return { ok: true, id, entryId, checked: c }
}

/**
 * Take a row off the register. A row this register posted must have its entry voided first (with
 * its audit reason, the usual correction), because the row is only the register and the books are
 * the entry. A linked row comes off directly; its entry stays where it was.
 */
export async function removeFacilityEvent(
  admin: SupabaseClient,
  fundId: string,
  group: string,
  id: unknown,
): Promise<{ ok: true; event: FacilityEvent } | { error: string }> {
  if (typeof id !== 'string' || !id) return { error: 'Which row? Pass its id (the facility list shows them).' }
  const register = await loadFacilityRegister(admin, fundId, group)
  const event = register.events.find(e => e.id === id)
  if (!event) return { error: `No facility row with that id on ${group}.` }
  if (event.origin === 'posted' && event.live) {
    return { error: 'This row posted its own entry. Void the entry first (with a reason), then remove the row.' }
  }
  const { error } = await (admin as any).from('credit_facility_events').delete().eq('fund_id', fundId).eq('vehicle_id', register.vehicleId).eq('id', id)
  if (error) return { error: `The row could not be removed: ${error.message}` }
  return { ok: true, event }
}
