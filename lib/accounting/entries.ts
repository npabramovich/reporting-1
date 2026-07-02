// Journal-entry builders. Each turns an engine result into ONE balanced entry
// with a single source_type, so the capital-account roll-forward buckets it
// correctly. Allocations post directly to LP capital (debit positive, so a
// credit that increases capital is negative), offset to the real account.
//
// Sign convention: contributions/gains credit LP capital (negative posting);
// distributions/fees/expenses/carry debit LP capital (positive posting).

import { roundCents, assertBalanced } from './ledger'
import { allocateAmount, type LpOwnership } from './allocation'
import type { FeeResult } from './fees'
import type { JournalEntry, Posting } from './types'

export type CapitalAccountMap = Map<string, string> // lpEntityId → account_id

interface Base {
  fundId: string
  entryDate: string
  memo?: string
}

function lpDebit(capMap: CapitalAccountMap, lpEntityId: string, amount: number, currency = 'USD'): Posting {
  const accountId = capMap.get(lpEntityId)
  if (!accountId) throw new Error(`No capital account for LP entity ${lpEntityId}`)
  return { accountId, amount: roundCents(amount), currency, lpEntityId }
}

function finalize(base: Base, sourceType: string, postings: Posting[]): JournalEntry {
  const entry: JournalEntry = { fundId: base.fundId, entryDate: base.entryDate, memo: base.memo, sourceType, postings }
  assertBalanced(entry)
  return entry
}

/** Capital call: debit cash, credit each LP's capital pro-rata by commitment. */
export function buildCapitalCallEntry(
  base: Base,
  total: number,
  owners: LpOwnership[],
  capMap: CapitalAccountMap,
  cashAccountId: string,
  currency = 'USD'
): JournalEntry {
  const alloc = allocateAmount(total, owners)
  const postings: Posting[] = [{ accountId: cashAccountId, amount: roundCents(total), currency, lpEntityId: null }]
  for (const [lpEntityId, share] of Array.from(alloc.entries())) {
    postings.push(lpDebit(capMap, lpEntityId, -share, currency)) // credit LP capital
  }
  return finalize(base, 'capital_call', postings)
}

/** Distribution: debit each LP's capital, credit cash. `perLp` amounts per LP. */
export function buildDistributionEntry(
  base: Base,
  perLp: Map<string, number>,
  capMap: CapitalAccountMap,
  cashAccountId: string,
  currency = 'USD'
): JournalEntry {
  let total = 0
  const postings: Posting[] = []
  for (const [lpEntityId, amt] of Array.from(perLp.entries())) {
    total = roundCents(total + amt)
    postings.push(lpDebit(capMap, lpEntityId, amt, currency))
  }
  postings.push({ accountId: cashAccountId, amount: roundCents(-total), currency, lpEntityId: null })
  return finalize(base, 'distribution', postings)
}

/** Management fee: debit each LP's capital by their fee, credit the offset (Due to GP / cash). */
export function buildManagementFeeEntry(
  base: Base,
  fee: FeeResult,
  capMap: CapitalAccountMap,
  offsetAccountId: string,
  currency = 'USD'
): JournalEntry {
  const postings: Posting[] = []
  for (const line of fee.lines) {
    if (line.fee === 0) continue
    postings.push(lpDebit(capMap, line.lpEntityId, line.fee, currency))
  }
  postings.push({ accountId: offsetAccountId, amount: roundCents(-fee.total), currency, lpEntityId: null })
  return finalize(base, 'management_fee', postings)
}

/** Partnership expense: allocate pro-rata, debit each LP's capital, credit cash. */
export function buildExpenseEntry(
  base: Base,
  total: number,
  owners: LpOwnership[],
  capMap: CapitalAccountMap,
  cashAccountId: string,
  currency = 'USD'
): JournalEntry {
  const alloc = allocateAmount(total, owners)
  const postings: Posting[] = []
  for (const [lpEntityId, share] of Array.from(alloc.entries())) {
    postings.push(lpDebit(capMap, lpEntityId, share, currency))
  }
  postings.push({ accountId: cashAccountId, amount: roundCents(-total), currency, lpEntityId: null })
  return finalize(base, 'partnership_expense', postings)
}

/** Carried interest: debit each LP's capital by their carry share, credit GP capital. */
export function buildCarryEntry(
  base: Base,
  perLpCarry: Map<string, number>,
  capMap: CapitalAccountMap,
  gpCapitalAccountId: string,
  currency = 'USD'
): JournalEntry {
  let total = 0
  const postings: Posting[] = []
  for (const [lpEntityId, amt] of Array.from(perLpCarry.entries())) {
    if (amt === 0) continue
    total = roundCents(total + amt)
    postings.push(lpDebit(capMap, lpEntityId, amt, currency))
  }
  postings.push({ accountId: gpCapitalAccountId, amount: roundCents(-total), currency, lpEntityId: null })
  return finalize(base, 'carried_interest', postings)
}
