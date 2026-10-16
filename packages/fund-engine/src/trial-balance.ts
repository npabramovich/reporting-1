// Trial balance and period scoping — the base every financial statement is a query over.

import type { Account, AccountType, Posting } from './types.ts'
import { NORMAL_SIDE } from './types.ts'

function r(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

export interface TrialBalanceRow {
  accountId: string
  code: string
  name: string
  type: AccountType
  /** Positive on the account's normal side. */
  balance: number
  debit: number
  credit: number
}

export interface TrialBalance {
  rows: TrialBalanceRow[]
  totalDebits: number
  totalCredits: number
  balanced: boolean
}

/**
 * Trial balance across a set of postings. Debit-side sum per account is split
 * into a positive debit or credit column; a well-formed ledger has equal totals.
 */
export function trialBalance(accounts: Account[], postings: Posting[]): TrialBalance {
  const byAccount = new Map<string, number>()
  for (const p of postings) {
    byAccount.set(p.accountId, r((byAccount.get(p.accountId) ?? 0) + p.amount))
  }

  const rows: TrialBalanceRow[] = []
  let totalDebits = 0
  let totalCredits = 0

  for (const acct of accounts) {
    const debitSide = r(byAccount.get(acct.id) ?? 0)
    if (debitSide === 0) continue
    const debit = debitSide > 0 ? debitSide : 0
    const credit = debitSide < 0 ? -debitSide : 0
    const balance = NORMAL_SIDE[acct.type] === 'debit' ? debitSide : r(-debitSide)
    totalDebits = r(totalDebits + debit)
    totalCredits = r(totalCredits + credit)
    rows.push({ accountId: acct.id, code: acct.code, name: acct.name, type: acct.type, balance, debit, credit })
  }

  rows.sort((a, b) => a.code.localeCompare(b.code))
  return { rows, totalDebits, totalCredits, balanced: r(totalDebits - totalCredits) === 0 }
}

/**
 * Postings within a window. A missing `entryDate` is treated as in-scope rather
 * than dropped — losing a posting would silently unbalance a statement, which is
 * far worse than including one whose date we don't know.
 */
export function postingsInPeriod<T extends Posting>(postings: T[], start?: string | null, end?: string | null): T[] {
  return postings.filter(p => {
    const d = p.entryDate
    if (!d) return true
    if (start && d < start) return false
    if (end && d > end) return false
    return true
  })
}

/** Postings cumulative up to and including a date — the basis for a balance sheet. */
export function postingsAsOf<T extends Posting>(postings: T[], end?: string | null): T[] {
  return postingsInPeriod(postings, null, end)
}
