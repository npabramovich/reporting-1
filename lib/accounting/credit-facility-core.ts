// Credit facilities, the pure half: balances, which draws a repayment paid off, and the entries a
// register row posts. No database here, so the arithmetic is pinned by credit-facility.test.ts.
// The register and its write path are lib/accounting/credit-facility.ts.

import type { JournalEntry } from './types'
import { roundCents } from './ledger'

export const FACILITY_KINDS = ['subscription', 'nav', 'other'] as const
export type FacilityKind = typeof FACILITY_KINDS[number]

export const FACILITY_EVENT_TYPES = ['draw', 'repayment', 'interest', 'fee'] as const
export type FacilityEventType = typeof FACILITY_EVENT_TYPES[number]

export const DRAW_PURPOSES = ['investment', 'management_fee', 'fund_expense', 'working_capital'] as const
export type DrawPurpose = typeof DRAW_PURPOSES[number]

export const FACILITY_KIND_LABEL: Record<FacilityKind, string> = {
  subscription: 'Subscription line',
  nav: 'NAV facility',
  other: 'Other borrowing',
}

export const EVENT_TYPE_LABEL: Record<FacilityEventType, string> = {
  draw: 'Draw',
  repayment: 'Repayment',
  interest: 'Interest',
  fee: 'Fee',
}

export const DRAW_PURPOSE_LABEL: Record<DrawPurpose, string> = {
  investment: 'Investments',
  management_fee: 'Management fees',
  fund_expense: 'Partnership expenses',
  working_capital: 'Working capital',
}

/** The source_ref a register-posted entry carries, so the entry leads back to its row. */
export const facilityEntryRef = (eventId: string) => `credit-facility:${eventId}`

export interface FacilityEvent {
  id: string
  facilityId: string
  type: FacilityEventType
  date: string
  amount: number
  purpose: DrawPurpose | null
  callId: string | null
  journalEntryId: string | null
  origin: 'posted' | 'linked'
  memo: string | null
  /** False when the entry behind the row has been voided: the row no longer counts. */
  live: boolean
}

export interface FacilityBalance {
  drawn: number
  repaid: number
  outstanding: number
  interest: number
  fees: number
}

/** Totals through `asOf` (inclusive) from the live rows of one facility. */
export function facilityBalance(events: FacilityEvent[], asOf?: string): FacilityBalance {
  const sum = (t: FacilityEventType) =>
    roundCents(events.filter(e => e.live && e.type === t && (!asOf || e.date <= asOf)).reduce((s, e) => s + e.amount, 0))
  const drawn = sum('draw')
  const repaid = sum('repayment')
  return { drawn, repaid, outstanding: roundCents(drawn - repaid), interest: sum('interest'), fees: sum('fee') }
}

export interface RepaymentSlice {
  repaymentId: string
  date: string
  purpose: DrawPurpose
  amount: number
}

export interface PurposeMatch {
  /** Each repayment split by the purposes of the draws it paid off. */
  repayments: RepaymentSlice[]
  /** What is still drawn at `asOf`, by purpose. */
  outstanding: { purpose: DrawPurpose; amount: number }[]
  /** Repaid beyond what had been drawn by that date (a data error worth showing). */
  overRepaid: number
}

/**
 * Match one facility's repayments to its draws, oldest draw first, through `asOf`. A repayment
 * carries no purpose of its own; it takes the purposes of the draws it retires, which is what the
 * Performance Template's synthetic repayment rows are typed by.
 */
export function matchRepayments(events: FacilityEvent[], asOf?: string): PurposeMatch {
  const live = events
    .filter(e => e.live && (!asOf || e.date <= asOf) && (e.type === 'draw' || e.type === 'repayment'))
    // Same day: the draw first, so a same-day repayment retires it.
    .sort((a, b) => a.date.localeCompare(b.date) || (a.type === b.type ? 0 : a.type === 'draw' ? -1 : 1))
  const open: { purpose: DrawPurpose; left: number }[] = []
  const repayments: RepaymentSlice[] = []
  let overRepaid = 0
  for (const e of live) {
    if (e.type === 'draw') {
      open.push({ purpose: e.purpose ?? 'investment', left: e.amount })
      continue
    }
    let left = e.amount
    const slices = new Map<DrawPurpose, number>()
    for (const d of open) {
      if (left <= 0.005) break
      if (d.left <= 0.005) continue
      const take = Math.min(d.left, left)
      d.left = roundCents(d.left - take)
      left = roundCents(left - take)
      slices.set(d.purpose, roundCents((slices.get(d.purpose) ?? 0) + take))
    }
    if (left > 0.005) overRepaid = roundCents(overRepaid + left)
    for (const [purpose, amount] of Array.from(slices.entries())) repayments.push({ repaymentId: e.id, date: e.date, purpose, amount })
  }
  const byPurpose = new Map<DrawPurpose, number>()
  for (const d of open) if (d.left > 0.005) byPurpose.set(d.purpose, roundCents((byPurpose.get(d.purpose) ?? 0) + d.left))
  return {
    repayments,
    outstanding: DRAW_PURPOSES.filter(p => byPurpose.has(p)).map(p => ({ purpose: p, amount: byPurpose.get(p)! })),
    overRepaid,
  }
}

export interface FacilityAccounts {
  cash: string
  loan: string
  interest: string
}

/**
 * The entry a register row posts:
 *   draw       Dr cash          / Cr loan payable
 *   repayment  Dr loan payable  / Cr cash
 *   interest   Dr interest expense / Cr cash   (an expense, so persistEntry allocates it)
 *   fee        the same as interest
 */
export function buildFacilityEntry(
  input: { fundId: string; eventId: string; type: FacilityEventType; date: string; amount: number; memo: string },
  accounts: FacilityAccounts,
): JournalEntry {
  const amount = roundCents(input.amount)
  const [debit, credit] =
    input.type === 'draw' ? [accounts.cash, accounts.loan]
    : input.type === 'repayment' ? [accounts.loan, accounts.cash]
    : [accounts.interest, accounts.cash]
  return {
    fundId: input.fundId,
    entryDate: input.date,
    memo: input.memo,
    sourceType: input.type === 'interest' || input.type === 'fee' ? 'partnership_expense' : 'manual',
    sourceRef: facilityEntryRef(input.eventId),
    postings: [
      { accountId: debit, amount, currency: 'USD', lpEntityId: null },
      { accountId: credit, amount: -amount, currency: 'USD', lpEntityId: null },
    ],
  }
}

/**
 * What an existing entry must show on the facility's account for a row to be linked to it:
 * a draw credits the loan, a repayment debits it, interest and fees debit the interest account.
 * Returns the matching amount on that account (positive), or 0 when the entry does not move it the
 * right way.
 */
export function linkedAmount(
  type: FacilityEventType,
  postings: { accountId: string; amount: number }[],
  accounts: Pick<FacilityAccounts, 'loan' | 'interest'>,
): number {
  const account = type === 'draw' || type === 'repayment' ? accounts.loan : accounts.interest
  const net = roundCents(postings.filter(p => p.accountId === account).reduce((s, p) => s + p.amount, 0))
  if (type === 'draw') return net < 0 ? -net : 0
  return net > 0 ? net : 0
}
