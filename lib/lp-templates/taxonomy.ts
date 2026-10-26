// The ILPA taxonomy: one place for the vocabulary of ILPA's three 2025 templates and for how the
// app's own records map onto it. Pure: no I/O, safe to import from a client component.
//
// ILPA designed the Reporting Template, the Capital Call & Distribution Template and the
// Performance Template to be read together: a notice, a quarterly report and a capital statement
// for the same partner must reconcile. So each template's vocabulary is re-exported here, beside the
// mappings from the books:
//
//   chart accounts      → the Reporting Template line a posting lands on (accountCategory). An
//                         account's stated ILPA category wins; otherwise its subtype decides.
//   capital postings    → the A.1 line a partner's capital movement lands on (capitalLine).
//   portfolio-company   → the B.1 line, and the offset category, a fee the adviser received
//   fees                  lands on (PORTFOLIO_FEE_LINES).
//   credit facilities   → the expense line a facility's interest or fee lands on (facilityExpenseLine).
//
// The CC&D and Performance types are mapped where their notices and flows are built
// (lib/lp-templates/ccd.ts, lib/lp-templates/performance-load.ts); their type lists live with them and are
// re-exported below.

import { bucketForSourceType, type RollForwardBucket } from '@/lib/accounting/capital-account'
import { PASS_THROUGH_CHART } from '@/lib/accounting/chart'
import type { FacilityEventType, FacilityKind } from '@/lib/accounting/credit-facility-core'
import type { PortfolioFeeKind } from '@/lib/accounting/portfolio-fees'
import { ILPA_CCD_VERSION } from './ccd-types'
import { ILPA_PERFORMANCE_VERSION } from './performance-types'
import {
  ACCOUNT_CATEGORIES, ILPA_REPORTING_VERSION,
  type AccountCategory, type ReportingLineKey,
} from './reporting-types'

export * from './reporting-types'
export {
  CCD_TRANSACTION_TYPES, ILPA_CCD_VERSION, ILPA_CCD_ATTRIBUTION,
  ccdColumn, ccdNetSign, ccdImpactValue,
  type CcdTransactionType, type CcdUnfundedImpact, type CcdInsideOutside, type CcdColumn,
} from './ccd-types'
export {
  PERFORMANCE_TYPES, ILPA_PERFORMANCE_VERSION, ILPA_PERFORMANCE_METHODOLOGY, ILPA_PERFORMANCE_ATTRIBUTION,
  TREATMENT, PERFORMANCE_SERIES, SERIES_LABEL, typeSign,
  type PerformanceType, type PerformanceSeries, type MultipleRole, type TypeTreatment,
} from './performance-types'

/** The version of each template this app follows. One line to change when ILPA revises one. */
export const ILPA_TEMPLATE_VERSIONS = {
  reporting: ILPA_REPORTING_VERSION,
  capitalCallDistribution: ILPA_CCD_VERSION,
  performance: ILPA_PERFORMANCE_VERSION,
} as const

// ─── Chart accounts ────────────────────────────────────────────────────────────────────────────

/**
 * The line each income and expense subtype of a fund's chart lands on when the account states no
 * ILPA category. A generic expense (5100 Partnership expenses) lands on "Other", which the template
 * asks to be footnoted, so a fund that wants the detail gives its expense accounts categories.
 */
export const ACCOUNT_SUBTYPE_CATEGORY: Readonly<Record<string, AccountCategory>> = {
  management_fee: 'mgmt_fee_gross',
  partnership_expense: 'ext_other',
  operating_expense: 'ext_other',
  organizational_expense: 'ext_organization',
  syndication_cost: 'offering_syndication_costs',
  // Interest on a credit facility is moved to the facility lines by the register that records it
  // (facilityExpenseLine); what no facility claims is other interest.
  interest_expense: 'ext_other_interest',
  legal: 'ext_legal',
  fund_administration: 'ext_admin',
  insurance: 'ext_insurance',
  travel: 'ext_travel',
  technology: 'ext_it',
  interest_income: 'interest_income',
  note_interest_income: 'interest_income',
  dividend_income: 'dividend_income',
  portfolio_income: 'other_investment_income',
  equity_method: 'other_investment_income',
  realized_gain: 'net_realized_gain',
  // ILPA counts currency translation in the unrealized gain, which the app keeps on its own line.
  unrealized: 'net_unrealized_gain',
  fx_translation: 'net_unrealized_gain',
}

/** Income and expense subtypes that exist only in the tax book: the Reporting Template is book basis. */
export const TAX_BOOK_SUBTYPES: ReadonlySet<string> = new Set(
  PASS_THROUGH_CHART.filter(a => a.type === 'income' || a.type === 'expense').map(a => a.subtype!),
)

/** The categories an income account can carry; every other category is for expense accounts. */
export const INCOME_CATEGORIES: ReadonlySet<AccountCategory> = new Set<AccountCategory>([
  'interest_income', 'dividend_income', 'other_investment_income', 'net_realized_gain', 'net_unrealized_gain',
])

export function isAccountCategory(value: unknown): value is AccountCategory {
  return typeof value === 'string' && (ACCOUNT_CATEGORIES as readonly string[]).includes(value)
}

/** The categories an account of this type may be given. */
export function categoriesForType(type: string): AccountCategory[] {
  if (type === 'income') return ACCOUNT_CATEGORIES.filter(c => INCOME_CATEGORIES.has(c))
  if (type === 'expense') return ACCOUNT_CATEGORIES.filter(c => !INCOME_CATEGORIES.has(c))
  return []
}

interface AccountLike {
  type: string
  subtype?: string | null
  /** The category the account states (chart_of_accounts.ilpa_category), if any. */
  ilpaCategory?: string | null
}

/** The line an account lands on by its subtype alone. Null for balance-sheet and tax-only accounts. */
export function defaultAccountCategory(account: AccountLike): AccountCategory | null {
  if (account.type !== 'income' && account.type !== 'expense') return null
  const subtype = account.subtype ?? ''
  if (TAX_BOOK_SUBTYPES.has(subtype)) return null
  const mapped = ACCOUNT_SUBTYPE_CATEGORY[subtype]
  if (mapped && INCOME_CATEGORIES.has(mapped) === (account.type === 'income')) return mapped
  return account.type === 'expense' ? 'ext_other' : 'other_investment_income'
}

/**
 * The Reporting Template line a posting to this account lands on: the category it states, when
 * that category suits its type, else its subtype's. Null for accounts outside the statement of
 * operations.
 */
export function accountCategory(account: AccountLike): AccountCategory | null {
  const fallback = defaultAccountCategory(account)
  if (!fallback) return null
  const stated = account.ilpaCategory
  if (isAccountCategory(stated) && categoriesForType(account.type).includes(stated)) return stated
  return fallback
}

/** Words in an account's name that point at one category. First match wins, so narrower words go first. */
const NAME_HINTS: [RegExp, AccountCategory][] = [
  [/broken[- ]deal/i, 'ext_broken_deals'],
  [/due diligence|diligence/i, 'ext_due_diligence'],
  [/valuation/i, 'ext_valuation'],
  [/audit/i, 'ext_audit'],
  [/tax (prep|return|advis|compliance)|tax preparation/i, 'ext_tax_prep'],
  [/administrat|fund admin|accounting/i, 'ext_admin'],
  [/legal|counsel|regulatory|compliance/i, 'ext_legal'],
  [/investigation|examination/i, 'ext_investigation'],
  [/custod/i, 'ext_custody'],
  [/bank (fee|charge)|wire fee/i, 'ext_bank_fees'],
  [/insurance|d&o/i, 'ext_insurance'],
  [/travel|entertainment|meals/i, 'ext_travel'],
  [/software|technology|\bit\b|data room|hosting/i, 'ext_it'],
  [/organi[sz]ation(al)? (cost|expense)|formation/i, 'ext_organization'],
  [/placement/i, 'placement_fees'],
  [/syndication|offering/i, 'offering_syndication_costs'],
  [/franchise tax|income tax|withholding|\btaxes\b/i, 'ext_taxes'],
]

/**
 * A category an expense account's NAME suggests, for the picker to offer. Never applied on its
 * own: a guess that files legal fees as audit misstates an LP report, so the person confirms it.
 */
export function suggestAccountCategory(name: string, type: string): AccountCategory | null {
  if (type !== 'expense') return null
  for (const [pattern, category] of NAME_HINTS) if (pattern.test(name)) return category
  return null
}

// ─── Capital accounts ──────────────────────────────────────────────────────────────────────────

/**
 * Where a partner's capital movement lands. 'accounts' means the statement of operations: the
 * detail comes from the income and expense accounts (accountCategory), not from the capital side.
 * 'carry' is the accrual a partner is charged or a recipient credited; 'carry_paid' is carry paid out.
 */
export type CapitalLine =
  | Extract<ReportingLineKey, 'beginning_nav' | 'contributions' | 'distributions' | 'partner_transfers' | 'carry_paid'>
  | 'carry'
  | 'accounts'
  | 'unclassified'

const BUCKET_LINE: Record<RollForwardBucket, CapitalLine> = {
  beginning: 'beginning_nav',
  contributions: 'contributions',
  distributions: 'distributions',
  transfers: 'partner_transfers',
  carriedInterest: 'carry',
  managementFees: 'accounts',
  expenses: 'accounts',
  operatingIncome: 'accounts',
  realizedGains: 'accounts',
  unrealizedGains: 'accounts',
  fxTranslation: 'accounts',
  unclassified: 'unclassified',
}

/** The A.1 line a posting to a partner's capital account lands on, by its entry's source type. */
export function capitalLine(sourceType: string | null | undefined, amount?: number): CapitalLine {
  if (sourceType === 'carry_distribution') return 'carry_paid'
  return BUCKET_LINE[bucketForSourceType(sourceType, amount)]
}

// ─── Registers ─────────────────────────────────────────────────────────────────────────────────

/** Each kind of portfolio-company fee: its B.1 line, and the offset category its offset share counts in. */
export const PORTFOLIO_FEE_LINES: Record<PortfolioFeeKind, { fee: ReportingLineKey; offset: ReportingLineKey }> = {
  transaction: { fee: 'pc_transaction', offset: 'offset_transaction' },
  monitoring: { fee: 'pc_monitoring', offset: 'offset_monitoring' },
  directors: { fee: 'pc_directors', offset: 'offset_directors' },
  other: { fee: 'pc_other', offset: 'offset_other' },
}

/** The expense line a credit facility's interest or fee lands on. A subscription line has its own; any other facility shares one. */
export function facilityExpenseLine(kind: FacilityKind, eventType: Extract<FacilityEventType, 'interest' | 'fee'>): AccountCategory {
  if (kind === 'subscription') return eventType === 'interest' ? 'ext_sub_facility_interest' : 'ext_sub_facility_fees'
  return eventType === 'interest' ? 'ext_other_facility_interest' : 'ext_other_facility_fees'
}
