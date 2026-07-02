import { describe, it, expect } from 'vitest'
import {
  parseTransactionsCsv,
  normalizeDate,
  dedupHash,
  suggestCategory,
  bankEntryPostings,
  summarizeBankRec,
} from './bank'
import { isBalanced } from './ledger'

describe('normalizeDate', () => {
  it('accepts ISO and M/D/Y', () => {
    expect(normalizeDate('2026-06-30')).toBe('2026-06-30')
    expect(normalizeDate('6/30/2026')).toBe('2026-06-30')
    expect(normalizeDate('06/05/26')).toBe('2026-06-05')
    expect(normalizeDate('nope')).toBeNull()
  })
})

describe('parseTransactionsCsv', () => {
  it('parses a signed-amount CSV', () => {
    const csv = 'Date,Description,Amount\n2026-06-01,Capital call Fund II,5000000\n2026-06-15,Audit fee,-12000'
    const { rows, errors } = parseTransactionsCsv(csv)
    expect(errors).toEqual([])
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ date: '2026-06-01', amount: 5000000, description: 'Capital call Fund II' })
    expect(rows[1].amount).toBe(-12000)
  })

  it('parses debit/credit columns and TSV', () => {
    const tsv = 'Date\tDescription\tDebit\tCredit\n06/15/2026\tWire in\t\t5000000\n06/20/2026\tLegal\t3000\t'
    const { rows } = parseTransactionsCsv(tsv)
    expect(rows[0].amount).toBe(5000000)
    expect(rows[1].amount).toBe(-3000)
  })

  it('handles quoted fields and accounting-negative parens', () => {
    const csv = 'Date,Description,Amount\n2026-06-01,"Fee, quarterly","(1,200.50)"'
    const { rows } = parseTransactionsCsv(csv)
    expect(rows[0].description).toBe('Fee, quarterly')
    expect(rows[0].amount).toBe(-1200.5)
  })

  it('reports bad rows instead of dropping silently', () => {
    const csv = 'Date,Description,Amount\nbadrow,x,y\n2026-06-01,ok,100'
    const { rows, errors } = parseTransactionsCsv(csv)
    expect(rows).toHaveLength(1)
    expect(errors.length).toBe(1)
  })

  it('errors when required columns are missing', () => {
    const { errors } = parseTransactionsCsv('Foo,Bar\n1,2')
    expect(errors.length).toBe(1)
  })
})

describe('dedupHash', () => {
  it('is stable and sensitive to the key fields', () => {
    const a = { date: '2026-06-01', amount: 100, description: 'Fee' }
    expect(dedupHash(a)).toBe(dedupHash({ ...a }))
    expect(dedupHash(a)).not.toBe(dedupHash({ ...a, amount: 101 }))
  })
})

describe('suggestCategory', () => {
  it('classifies by keyword', () => {
    expect(suggestCategory({ date: 'd', amount: 5e6, description: 'Capital call' }).sourceType).toBe('capital_call')
    expect(suggestCategory({ date: 'd', amount: -12000, description: 'Annual audit' }).sourceType).toBe('partnership_expense')
    expect(suggestCategory({ date: 'd', amount: -50000, description: 'Management fee Q2' }).sourceType).toBe('management_fee')
  })

  it('falls back by direction with low confidence', () => {
    expect(suggestCategory({ date: 'd', amount: 999, description: 'mystery' }).confidence).toBe('low')
    expect(suggestCategory({ date: 'd', amount: -999, description: 'mystery' }).sourceType).toBe('partnership_expense')
  })
})

describe('bankEntryPostings', () => {
  it('builds a balanced two-line entry for inflow and outflow', () => {
    const inflow = bankEntryPostings(5000, 'cash', 'lp')
    expect(isBalanced({ fundId: 'f', entryDate: 'd', postings: inflow })).toBe(true)
    expect(inflow.find(p => p.accountId === 'cash')!.amount).toBe(5000)

    const outflow = bankEntryPostings(-3000, 'cash', 'exp')
    expect(isBalanced({ fundId: 'f', entryDate: 'd', postings: outflow })).toBe(true)
    expect(outflow.find(p => p.accountId === 'cash')!.amount).toBe(-3000)
  })
})

describe('summarizeBankRec', () => {
  it('ties out when ledger cash equals the bank feed and all matched', () => {
    const s = summarizeBankRec([{ amount: 5000, matched: true }, { amount: -2000, matched: true }], 3000)
    expect(s.bankEndingBalance).toBe(3000)
    expect(s.difference).toBe(0)
    expect(s.tiesOut).toBe(true)
  })

  it('surfaces unmatched transactions and the difference', () => {
    const s = summarizeBankRec([{ amount: 5000, matched: true }, { amount: -2000, matched: false }], 5000)
    expect(s.unmatchedCount).toBe(1)
    expect(s.unmatchedTotal).toBe(-2000)
    expect(s.bankEndingBalance).toBe(3000)
    expect(s.difference).toBe(2000) // ledger cash still shows the unbooked outflow
    expect(s.tiesOut).toBe(false)
  })
})
