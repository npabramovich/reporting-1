// Bank ingestion: parse a transaction feed (CSV/Excel paste), dedup it, suggest
// a chart account per row, and build a balanced draft entry. Source-agnostic —
// Plaid/Ramp/QuickBooks connectors normalize into the same ParsedTxn shape and
// reuse everything below. Pure and testable; the API does the persistence.

import { roundCents } from './ledger'
import type { Posting } from './types'

export interface ParsedTxn {
  date: string        // ISO YYYY-MM-DD
  amount: number      // signed: + inflow, - outflow
  description: string
  counterparty?: string
}

// ---------------------------------------------------------------------------
// CSV / TSV parsing
// ---------------------------------------------------------------------------

/** Split one delimited line, honoring double-quoted fields. */
function splitLine(line: string, delim: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++ } else inQuotes = false
      } else cur += c
    } else if (c === '"') inQuotes = true
    else if (c === delim) { out.push(cur); cur = '' }
    else cur += c
  }
  out.push(cur)
  return out.map(s => s.trim())
}

/** Normalize a date string to ISO (YYYY-MM-DD). Accepts ISO and M/D/Y. */
export function normalizeDate(s: string): string | null {
  const t = s.trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10)
  const m = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/)
  if (m) {
    let [, mo, d, y] = m
    if (y.length === 2) y = '20' + y
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`
  }
  return null
}

function parseAmount(s: string): number | null {
  if (s == null) return null
  const neg = /^\(.*\)$/.test(s.trim()) // (123.45) accounting negative
  const cleaned = s.replace(/[(),$\s]/g, '')
  if (cleaned === '' || isNaN(Number(cleaned))) return null
  const n = Number(cleaned)
  return neg ? -Math.abs(n) : n
}

const HEADER_ALIASES: Record<string, string[]> = {
  date: ['date', 'posted', 'transaction date', 'post date'],
  description: ['description', 'memo', 'name', 'details', 'narrative'],
  amount: ['amount', 'value'],
  debit: ['debit', 'withdrawal', 'withdrawals', 'money out', 'outflow'],
  credit: ['credit', 'deposit', 'deposits', 'money in', 'inflow'],
  counterparty: ['counterparty', 'payee', 'merchant', 'vendor'],
}

function matchHeader(cell: string): string | null {
  const c = cell.toLowerCase().trim()
  for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
    if (aliases.includes(c)) return key
  }
  return null
}

export interface ParseResult {
  rows: ParsedTxn[]
  errors: string[]
}

/**
 * Parse pasted CSV/TSV bank transactions. Detects the delimiter and maps common
 * headers (date, description, amount OR debit/credit, counterparty). Rows that
 * can't be parsed are reported, not silently dropped.
 */
export function parseTransactionsCsv(text: string): ParseResult {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  if (lines.length === 0) return { rows: [], errors: ['No rows found'] }

  const delim = (lines[0].match(/\t/g)?.length ?? 0) > (lines[0].match(/,/g)?.length ?? 0) ? '\t' : ','
  const header = splitLine(lines[0], delim)
  const cols = header.map(matchHeader)
  const has = (k: string) => cols.includes(k)
  if (!has('date') || (!has('amount') && !has('credit') && !has('debit'))) {
    return { rows: [], errors: ['Could not find a date column and an amount (or debit/credit) column in the header'] }
  }

  const idx = (k: string) => cols.indexOf(k)
  const rows: ParsedTxn[] = []
  const errors: string[] = []

  for (let i = 1; i < lines.length; i++) {
    const cells = splitLine(lines[i], delim)
    const rawDate = cells[idx('date')] ?? ''
    const date = normalizeDate(rawDate)
    if (!date) { errors.push(`Row ${i + 1}: unparseable date "${rawDate}"`); continue }

    let amount: number | null = null
    if (has('amount')) amount = parseAmount(cells[idx('amount')] ?? '')
    else {
      const credit = has('credit') ? parseAmount(cells[idx('credit')] ?? '') ?? 0 : 0
      const debit = has('debit') ? parseAmount(cells[idx('debit')] ?? '') ?? 0 : 0
      amount = roundCents(Math.abs(credit) - Math.abs(debit))
    }
    if (amount == null || isNaN(amount)) { errors.push(`Row ${i + 1}: unparseable amount`); continue }

    rows.push({
      date,
      amount: roundCents(amount),
      description: (has('description') ? cells[idx('description')] : '') ?? '',
      counterparty: has('counterparty') ? cells[idx('counterparty')] : undefined,
    })
  }

  return { rows, errors }
}

// ---------------------------------------------------------------------------
// Dedup
// ---------------------------------------------------------------------------

/** Stable non-crypto hash (FNV-1a) for import idempotency. */
export function dedupHash(t: ParsedTxn): string {
  const s = `${t.date}|${t.amount.toFixed(2)}|${(t.description || '').toLowerCase().trim()}`
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

// ---------------------------------------------------------------------------
// Categorization (deterministic first pass; AI can refine)
// ---------------------------------------------------------------------------

export interface Category {
  /** Chart account code for the NON-cash side of the entry. */
  accountCode: string
  sourceType: string
  label: string
  confidence: 'high' | 'low'
}

const RULES: { re: RegExp; accountCode: string; sourceType: string; label: string }[] = [
  { re: /capital call|drawdown|contribution|subscription/i, accountCode: '3100', sourceType: 'capital_call', label: 'Capital call' },
  { re: /distribution|redemption/i, accountCode: '3100', sourceType: 'distribution', label: 'Distribution' },
  { re: /management fee|mgmt fee/i, accountCode: '5000', sourceType: 'management_fee', label: 'Management fee' },
  { re: /audit|legal|tax|accounting|admin|filing|fund expense|organization/i, accountCode: '5100', sourceType: 'partnership_expense', label: 'Partnership expense' },
  { re: /interest|dividend/i, accountCode: '4100', sourceType: 'income', label: 'Interest / dividend income' },
]

/**
 * Suggest the non-cash account + source type for a transaction. Keyword rules
 * first; otherwise fall back by direction (inflow → unallocated LP capital as a
 * likely call; outflow → partnership expense), flagged low-confidence for review.
 */
export function suggestCategory(t: ParsedTxn): Category {
  for (const r of RULES) {
    if (r.re.test(t.description || '')) {
      return { accountCode: r.accountCode, sourceType: r.sourceType, label: r.label, confidence: 'high' }
    }
  }
  return t.amount >= 0
    ? { accountCode: '3100', sourceType: 'capital_call', label: 'Unclassified inflow', confidence: 'low' }
    : { accountCode: '5100', sourceType: 'partnership_expense', label: 'Unclassified expense', confidence: 'low' }
}

/**
 * Two-line balanced postings for a bank transaction: an inflow debits cash and
 * credits the other account; an outflow does the reverse.
 */
export function bankEntryPostings(amount: number, cashAccountId: string, otherAccountId: string, currency = 'USD'): Posting[] {
  const amt = roundCents(amount)
  return [
    { accountId: cashAccountId, amount: amt, currency, lpEntityId: null },
    { accountId: otherAccountId, amount: roundCents(-amt), currency, lpEntityId: null },
  ]
}

// ---------------------------------------------------------------------------
// Bank reconciliation
// ---------------------------------------------------------------------------

export interface BankTxnState {
  amount: number
  matched: boolean // has a posted ledger entry
}

export interface BankRecSummary {
  bankEndingBalance: number
  ledgerCashBalance: number
  difference: number
  matchedCount: number
  unmatchedCount: number
  unmatchedTotal: number
  tiesOut: boolean
}

/**
 * Reconcile the ledger's cash against the bank feed. The bank's ending balance
 * is the opening balance plus every imported transaction; it should equal the
 * ledger cash balance once every transaction is matched to a posted entry. The
 * difference and the unmatched items localize what's left to book.
 */
export function summarizeBankRec(
  txns: BankTxnState[],
  ledgerCashBalance: number,
  openingCash = 0
): BankRecSummary {
  const bankEndingBalance = roundCents(txns.reduce((s, t) => s + t.amount, openingCash))
  const unmatched = txns.filter(t => !t.matched)
  const difference = roundCents(ledgerCashBalance - bankEndingBalance)
  return {
    bankEndingBalance,
    ledgerCashBalance: roundCents(ledgerCashBalance),
    difference,
    matchedCount: txns.length - unmatched.length,
    unmatchedCount: unmatched.length,
    unmatchedTotal: roundCents(unmatched.reduce((s, t) => s + t.amount, 0)),
    tiesOut: difference === 0 && unmatched.length === 0,
  }
}
