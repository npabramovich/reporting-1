// Financial statements derived from the ledger. Everything here is a query over
// the trial balance — no separately maintained figures. Kept pure so it can be
// unit-tested and reused by the API and PDF/report layers.

import type { Account, AccountType, Posting } from './types'
import { NORMAL_SIDE } from './types'

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

export interface StatementSection {
  label: string
  rows: { code: string; name: string; amount: number }[]
  total: number
}

function section(label: string, tb: TrialBalance, type: AccountType): StatementSection {
  const rows = tb.rows.filter(r0 => r0.type === type).map(r0 => ({ code: r0.code, name: r0.name, amount: r0.balance }))
  const total = r(rows.reduce((a, b) => a + b.amount, 0))
  return { label, rows, total }
}

export interface BalanceSheet {
  assets: StatementSection
  liabilities: StatementSection
  equity: StatementSection
  /** assets − liabilities − equity; zero when the ledger balances. */
  check: number
}

/** Balance sheet: assets = liabilities + partners' capital. */
export function balanceSheet(accounts: Account[], postings: Posting[]): BalanceSheet {
  const tb = trialBalance(accounts, postings)
  const assets = section('Assets', tb, 'asset')
  const liabilities = section('Liabilities', tb, 'liability')
  const equity = section("Partners' capital", tb, 'equity')
  return { assets, liabilities, equity, check: r(assets.total - liabilities.total - equity.total) }
}

export interface IncomeStatement {
  income: StatementSection
  expenses: StatementSection
  netIncome: number
}

/** Income statement: net income = income − expenses. */
export function incomeStatement(accounts: Account[], postings: Posting[]): IncomeStatement {
  const tb = trialBalance(accounts, postings)
  const income = section('Income', tb, 'income')
  const expenses = section('Expenses', tb, 'expense')
  return { income, expenses, netIncome: r(income.total - expenses.total) }
}
