import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { DEFAULT_CHART, PASS_THROUGH_CHART } from '@/lib/accounting/chart'
import { RECYCLED_PROCEEDS_SOURCE } from '@/lib/accounting/capital-account'
import { FACILITY_KINDS } from '@/lib/accounting/credit-facility-core'
import { PORTFOLIO_FEE_KINDS } from '@/lib/accounting/portfolio-fees'
import {
  ACCOUNT_CATEGORIES, ACCOUNT_SUBTYPE_CATEGORY, CCD_TRANSACTION_TYPES, ILPA_TEMPLATE_VERSIONS, INCOME_CATEGORIES,
  PERFORMANCE_TYPES, PORTFOLIO_FEE_LINES, REDUCTION_CATEGORIES, REPORTING_LINE, REPORTING_LINES,
  accountCategory, accountCategoryName, capitalLine, categoriesForType, defaultAccountCategory, facilityExpenseLine,
  suggestAccountCategory,
} from './taxonomy'

describe('the Reporting Template lines', () => {
  it('have unique keys and unique labels', () => {
    expect(new Set(REPORTING_LINES.map(l => l.key)).size).toBe(REPORTING_LINES.length)
    expect(new Set(REPORTING_LINES.map(l => l.label)).size).toBe(REPORTING_LINES.length)
  })

  it('run in the template order: A.1, then A.2, then B.1', () => {
    const sections = REPORTING_LINES.map(l => l.section)
    expect(sections.indexOf('A.2')).toBeGreaterThan(sections.lastIndexOf('A.1'))
    expect(sections.indexOf('B.1')).toBeGreaterThan(sections.lastIndexOf('A.2'))
  })

  it('mark every "Other" line for a footnote', () => {
    const marked = REPORTING_LINES.filter(l => 'needsFootnote' in l).map(l => l.key)
    expect(marked).toEqual(['related_other', 'ext_other', 'offset_other', 'pc_other'])
    for (const key of marked) expect(REPORTING_LINE[key as keyof typeof REPORTING_LINE].label).toContain('*')
  })

  it('give accounts only A.1 input lines', () => {
    for (const c of ACCOUNT_CATEGORIES) {
      expect(REPORTING_LINE[c].section).toBe('A.1')
      expect(REPORTING_LINE[c].kind).toBe('input')
    }
    for (const c of REDUCTION_CATEGORIES) expect(REPORTING_LINE[c].label).toMatch(/^Less /)
  })

  it('name each category for a picker without the template punctuation', () => {
    expect(accountCategoryName('ext_audit')).toBe('Third-Party Audit')
    expect(accountCategoryName('mgmt_fee_offset')).toBe('Offsets to Management Fees (Applied During Period)')
    expect(accountCategoryName('related_other')).toBe('Related persons – Other')
  })

  it('carry each template version in one place', () => {
    expect(ILPA_TEMPLATE_VERSIONS).toEqual({ reporting: '2.0', capitalCallDistribution: '2.0', performance: '1.1' })
    expect(CCD_TRANSACTION_TYPES).toHaveLength(27)
    expect(PERFORMANCE_TYPES).toHaveLength(20)
  })
})

describe('chart accounts', () => {
  const pnl = DEFAULT_CHART.filter(a => a.type === 'income' || a.type === 'expense')

  it('every income and expense account of the default chart has its own mapping, not the fallback', () => {
    for (const a of pnl) {
      expect(ACCOUNT_SUBTYPE_CATEGORY[a.subtype!], `${a.code} ${a.name}`).toBeDefined()
      expect(defaultAccountCategory(a), `${a.code} ${a.name}`).toBe(ACCOUNT_SUBTYPE_CATEGORY[a.subtype!])
    }
  })

  it('maps an income account to an income line and an expense account to a fee or expense line', () => {
    for (const a of pnl) {
      const c = defaultAccountCategory(a)!
      expect(INCOME_CATEGORIES.has(c), `${a.code} ${a.name}`).toBe(a.type === 'income')
    }
  })

  it('leaves the balance sheet and the tax-only accounts off the template', () => {
    for (const a of DEFAULT_CHART.filter(x => x.type !== 'income' && x.type !== 'expense')) expect(defaultAccountCategory(a)).toBeNull()
    for (const a of PASS_THROUGH_CHART) expect(defaultAccountCategory(a), a.code).toBeNull()
  })

  it('sends an account with an unknown subtype to Other', () => {
    expect(defaultAccountCategory({ type: 'expense', subtype: null })).toBe('ext_other')
    expect(defaultAccountCategory({ type: 'income', subtype: 'something_new' })).toBe('other_investment_income')
  })

  it("uses the account's stated category when it suits the account's type", () => {
    expect(accountCategory({ type: 'expense', subtype: 'partnership_expense', ilpaCategory: 'ext_audit' })).toBe('ext_audit')
    expect(accountCategory({ type: 'expense', subtype: 'management_fee', ilpaCategory: 'mgmt_fee_offset' })).toBe('mgmt_fee_offset')
    // An income line on an expense account, or a word that is not a category, is ignored.
    expect(accountCategory({ type: 'expense', subtype: 'partnership_expense', ilpaCategory: 'dividend_income' })).toBe('ext_other')
    expect(accountCategory({ type: 'expense', subtype: 'partnership_expense', ilpaCategory: 'legal' })).toBe('ext_other')
    expect(accountCategory({ type: 'asset', subtype: 'cash', ilpaCategory: 'ext_audit' })).toBeNull()
  })

  it('offers income categories to income accounts and the rest to expense accounts', () => {
    const income = categoriesForType('income')
    const expense = categoriesForType('expense')
    expect(income.length + expense.length).toBe(ACCOUNT_CATEGORIES.length)
    expect(income).toContain('net_realized_gain')
    expect(expense).toContain('ext_legal')
    expect(categoriesForType('asset')).toEqual([])
  })

  it('suggests a category from an expense account name, and nothing for an income account', () => {
    expect(suggestAccountCategory('Audit fees', 'expense')).toBe('ext_audit')
    expect(suggestAccountCategory('Fund administration', 'expense')).toBe('ext_admin')
    expect(suggestAccountCategory('Legal — fund counsel', 'expense')).toBe('ext_legal')
    expect(suggestAccountCategory('Broken deal costs', 'expense')).toBe('ext_broken_deals')
    expect(suggestAccountCategory('D&O insurance', 'expense')).toBe('ext_insurance')
    expect(suggestAccountCategory('Miscellaneous', 'expense')).toBeNull()
    expect(suggestAccountCategory('Audit fee income', 'income')).toBeNull()
  })
})

describe('capital postings', () => {
  // Every source type the capital-account roll-forward names, read from its switch, so a new one
  // cannot reach a partner's capital without a Reporting Template line.
  const source = readFileSync(join(process.cwd(), 'packages/fund-engine/src/capital-account.ts'), 'utf8')
  const body = source.slice(source.indexOf('export function bucketForSourceType'), source.indexOf('export function emptyAccount'))
  const named = Array.from(body.matchAll(/case '([a-z_]+)':/g), m => m[1])

  it('reads the source types from the roll-forward', () => {
    expect(named).toContain('capital_call')
    expect(named).toContain('carry_distribution')
    expect(named.length).toBeGreaterThan(20)
  })

  it('maps every named source type to a line', () => {
    for (const t of named) expect(capitalLine(t, 1), t).not.toBe('unclassified')
    expect(capitalLine(RECYCLED_PROCEEDS_SOURCE, 100)).toBe('distributions')
    expect(capitalLine(RECYCLED_PROCEEDS_SOURCE, -100)).toBe('contributions')
  })

  it('puts the flows on their own lines and the profit and loss on the accounts', () => {
    expect(capitalLine('opening_balance')).toBe('beginning_nav')
    expect(capitalLine('capital_call')).toBe('contributions')
    expect(capitalLine('distribution')).toBe('distributions')
    expect(capitalLine('transfer')).toBe('partner_transfers')
    expect(capitalLine('carried_interest')).toBe('carry')
    expect(capitalLine('carry_distribution')).toBe('carry_paid')
    expect(capitalLine('partnership_expense')).toBe('accounts')
    expect(capitalLine('valuation')).toBe('accounts')
    expect(capitalLine('manual')).toBe('unclassified')
  })
})

describe('registers', () => {
  it('gives every kind of portfolio-company fee a B.1 line and an offset category', () => {
    for (const kind of PORTFOLIO_FEE_KINDS) {
      const lines = PORTFOLIO_FEE_LINES[kind]
      expect(REPORTING_LINE[lines.fee].section).toBe('B.1')
      expect(REPORTING_LINE[lines.offset].label).toMatch(/Offset/)
    }
  })

  it('gives every facility kind an interest line and a fee line', () => {
    for (const kind of FACILITY_KINDS) {
      expect(REPORTING_LINE[facilityExpenseLine(kind, 'interest')].label).toMatch(/Interest/)
      expect(REPORTING_LINE[facilityExpenseLine(kind, 'fee')].label).toMatch(/Fees/)
    }
    expect(facilityExpenseLine('subscription', 'interest')).toBe('ext_sub_facility_interest')
    expect(facilityExpenseLine('nav', 'fee')).toBe('ext_other_facility_fees')
  })
})
