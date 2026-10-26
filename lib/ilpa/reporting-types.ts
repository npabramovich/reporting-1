// The ILPA Reporting Template (v. 2.0, January 2025): its lines, in the template's order, with the
// labels spelled exactly as the template spells them. Pure data, no I/O.
//
// The template is one partner's quarterly capital account statement in three allocations (the
// partner, the whole fund including the GP, and the GP), each quarter to date, year to date and
// inception to date:
//
//   A.1  the NAV roll-forward, with fees, expenses and offsets broken into ILPA's categories, then
//        the carried interest roll-forward;
//   A.2  the commitment reconciliation;
//   B.1  fees the adviser and its related persons receive from the fund's portfolio companies.
//
// SIGNS follow the template: contributions, income and gains positive; distributions, fees and
// expenses negative; the "Less ..." lines (rebates, waivers, offsets applied) positive, because
// they reduce a negative. Carried interest is shown from the paying partners' side, negative.
//
// The labels are the vocabulary, not ILPA's workbook: the file this app produces is its own layout
// carrying the template's lines (lib/ilpa/reporting.ts).

export const ILPA_REPORTING_VERSION = '2.0'

/** The credit every Reporting Template file carries: ILPA created the template it follows, and does not endorse this software. */
export const ILPA_REPORTING_ATTRIBUTION =
  `This file follows the ILPA Reporting Template (v. ${ILPA_REPORTING_VERSION}), created by the Institutional Limited ` +
  'Partners Association (ILPA), with thanks to ILPA for developing it as an industry standard. The template is ' +
  "ILPA's; this software is not affiliated with or endorsed by ILPA."

export type ReportingSection = 'A.1' | 'A.2' | 'B.1'

/** The template's section titles; {partner} is the partner's name. */
export const REPORTING_SECTION_TITLE = {
  A: 'A. Capital Account Statement for {partner}',
  'A.1': 'A.1 NAV Reconciliation and Summary of Fees, Expenses & Carried Interest',
  'A.2': 'A.2 Commitment Reconciliation',
  B: "B. Schedule of Fees and Reimbursements Received by the Investment Adviser & Related Persons, with Respect to the Private Fund's Portfolio Companies/Investments",
  'B.1': "B.1 With Respect to the Private Fund's Portfolio Companies/Investments",
} as const

/**
 * heading   a label with no figures
 * input     a figure the books supply
 * subtotal  a figure the template sums from the lines above it
 */
export type ReportingRowKind = 'heading' | 'input' | 'subtotal'

export interface ReportingLine {
  key: string
  label: string
  section: ReportingSection
  kind: ReportingRowKind
  /** Lines the template marks with an asterisk: any amount in them needs a footnote. */
  needsFootnote?: true
}

const line = <K extends string>(key: K, label: string, section: ReportingSection, kind: ReportingRowKind, needsFootnote?: true): ReportingLine & { key: K } =>
  ({ key, label, section, kind, ...(needsFootnote ? { needsFootnote } : {}) })

export const REPORTING_LINES = [
  // A.1 NAV reconciliation
  line('beginning_nav', 'Beginning NAV – Net of Accrued/Earned/Paid Carried Interest', 'A.1', 'input'),
  line('contributions', 'Contributions – Cash & Non-Cash', 'A.1', 'input'),
  line('distributions', 'Distributions – Cash & Non-Cash', 'A.1', 'input'),
  line('offering_syndication_costs', 'Offering/Syndication Costs', 'A.1', 'input'),
  line('placement_fees', 'Placement Fees', 'A.1', 'input'),
  line('partner_transfers', 'Partner Transfers', 'A.1', 'input'),
  line('total_flows', 'Total Cash / Non-Cash Flows (Contributions, Less Distributions)', 'A.1', 'subtotal'),
  line('net_operating_heading', 'Net Operating Income/(Expense)', 'A.1', 'heading'),
  line('mgmt_fee_heading', 'Management Fees', 'A.1', 'heading'),
  line('mgmt_fee_gross', '(Management Fees – Gross of Offsets, Waivers & Rebates)', 'A.1', 'input'),
  line('mgmt_fee_rebate', 'Less Management Fee Rebate (input positive values)', 'A.1', 'input'),
  line('mgmt_fee_waiver', 'Less Fee Waivers (input positive values)', 'A.1', 'input'),
  line('mgmt_fee_offset', 'Less Offsets to Management Fees (Applied During Period) (input positive values)', 'A.1', 'input'),
  line('mgmt_fee_net', '(Management Fees – Net of Offsets, Waivers & Rebates)', 'A.1', 'subtotal'),
  line('related_heading', 'Expenses Allocated/Paid to Investment Adviser or Related Persons', 'A.1', 'heading'),
  line('related_admin', '(Internal Staff/Related Persons – Administration, Accounting, Valuation, Audit & Tax Prep/Advisory)', 'A.1', 'input'),
  line('related_it', '(Internal Staff/Related Persons – IT Activities)', 'A.1', 'input'),
  line('related_legal', '(Internal Staff/Related Persons – Legal, Regulatory, Compliance, Investigation & Examination)', 'A.1', 'input'),
  line('related_organization', '(Internal Staff/Related Persons – Organization Costs)', 'A.1', 'input'),
  line('related_other', '(Internal Staff/Related Persons – Other)*', 'A.1', 'input', true),
  line('related_gross', '(Expenses Allocated/Paid to Investment Adviser or Related Persons – Gross of Offsets)', 'A.1', 'subtotal'),
  line('related_offset', 'Less Offsets to Expenses Paid to the Investment Adviser & Related Persons (Applied During Period) (input positive values)', 'A.1', 'input'),
  line('related_net', '(Expenses Allocated/Paid to Investment Adviser or Related Persons – Net of Offsets)', 'A.1', 'subtotal'),
  line('external_heading', 'Partnership Expenses – External', 'A.1', 'heading'),
  line('ext_admin', '(Partnership Expenses – Third-Party Fund Administration & Accounting)', 'A.1', 'input'),
  line('ext_valuation', '(Partnership Expenses – Third-Party Valuation Services)', 'A.1', 'input'),
  line('ext_it', '(Partnership Expenses – Third-Party IT Activities)', 'A.1', 'input'),
  line('ext_legal', '(Partnership Expenses – Third-Party Legal, Regulatory & Compliance)', 'A.1', 'input'),
  line('ext_investigation', '(Partnership Expenses – Third-Party Investigation & Examination)', 'A.1', 'input'),
  line('ext_audit', '(Partnership Expenses – Third-Party Audit)', 'A.1', 'input'),
  line('ext_tax_prep', '(Partnership Expenses – Third-Party Tax Preparation & Tax Advisory)', 'A.1', 'input'),
  line('ext_organization', '(Partnership Expenses – Third-Party Organization Costs)', 'A.1', 'input'),
  line('ext_taxes', '(Partnership Expenses – Taxes)', 'A.1', 'input'),
  line('ext_bank_fees', '(Partnership Expenses – Bank Fees)', 'A.1', 'input'),
  line('ext_sub_facility_fees', '(Partnership Expenses – Subscription Facility – Fees)', 'A.1', 'input'),
  line('ext_sub_facility_interest', '(Partnership Expenses – Subscription Facility – Interest)', 'A.1', 'input'),
  line('ext_other_facility_fees', '(Partnership Expenses – Other Credit Facilities – Fees)', 'A.1', 'input'),
  line('ext_other_facility_interest', '(Partnership Expenses – Other Credit Facilities – Interest)', 'A.1', 'input'),
  line('ext_other_interest', '(Partnership Expenses – Other Interest Expense)', 'A.1', 'input'),
  line('ext_custody', '(Partnership Expenses – Custody Fees)', 'A.1', 'input'),
  line('ext_due_diligence', '(Partnership Expenses – Due Diligence)', 'A.1', 'input'),
  line('ext_broken_deals', '(Partnership Expenses – Broken Deals)', 'A.1', 'input'),
  line('ext_travel', '(Partnership Expenses – Travel & Entertainment)', 'A.1', 'input'),
  line('ext_insurance', '(Partnership Expenses – Insurance)', 'A.1', 'input'),
  line('ext_portfolio_costs', '(Partnership Expenses – Non-recoverable Portfolio Costs / Unreimbursed Portfolio Company Expenses)', 'A.1', 'input'),
  line('ext_other', '(Partnership Expenses – Other)*', 'A.1', 'input', true),
  line('ext_other_2016', '(Partnership Expenses – Other: 2016 ILPA Reporting Template Value)', 'A.1', 'input'),
  line('ext_gross', '(External Partnership Expenses – Gross of Offsets, Waivers & Rebates)', 'A.1', 'subtotal'),
  line('ext_offset', 'Less Offsets to External Partnership Expenses (Applied During Period) (input positive values)', 'A.1', 'input'),
  line('ext_net', '(External Partnership Expenses - Net of Offsets, Waivers & Rebates', 'A.1', 'subtotal'),
  line('total_net_expenses', 'Total Net Expenses Allocated/Paid to Investment Adviser or Related Persons and Partnership Expenses – External', 'A.1', 'subtotal'),
  line('offset_categories_heading', 'Offset Categories', 'A.1', 'heading'),
  line('offset_advisory', 'Advisory & Consulting Fee Offset', 'A.1', 'input'),
  line('offset_broken_deal', 'Broken Deal Fee Offset', 'A.1', 'input'),
  line('offset_transaction', 'Transaction & Deal Fee Offset', 'A.1', 'input'),
  line('offset_directors', 'Directors Fee Offset', 'A.1', 'input'),
  line('offset_monitoring', 'Monitoring Fee Offset', 'A.1', 'input'),
  line('offset_capital_markets', 'Capital Markets Fee Offset', 'A.1', 'input'),
  line('offset_arrangement', 'Arrangement Fee Offset', 'A.1', 'input'),
  line('offset_origination', 'Origination Fee Offset', 'A.1', 'input'),
  line('offset_organization', 'Organization Cost Offset', 'A.1', 'input'),
  line('offset_placement', 'Placement Fee Offset', 'A.1', 'input'),
  line('offset_other', 'Other Offsets*', 'A.1', 'input', true),
  line('offset_other_2016', 'Other Fee Offsets: 2016 ILPA Reporting Template Value', 'A.1', 'input'),
  line('offsets_recognized', 'Total Offsets to Fees & Expenses (Recognized During Period)', 'A.1', 'subtotal'),
  line('offsets_applied', 'Total Offsets to Fees & Expenses (Applied During Period)', 'A.1', 'subtotal'),
  line('unapplied_beginning', 'Unapplied Offset Balance (Roll-forward) – Beginning Balance', 'A.1', 'input'),
  line('unapplied_recognized', 'Plus: Total Offsets to Fees & Expenses (Recognized During Period)', 'A.1', 'subtotal'),
  line('unapplied_applied', 'Less: Total Offsets to Fees & Expenses (Applied During Period)', 'A.1', 'subtotal'),
  line('unapplied_ending', 'Unapplied Offset Balance (Roll-forward) – Ending Balance', 'A.1', 'subtotal'),
  line('fees_expenses_net', 'Total Fees & Expenses, Net of Offsets, Waivers & Rebates', 'A.1', 'subtotal'),
  line('fees_gross', 'Total Fees & Expenses: Gross of Offsets, Waivers & Rebates', 'A.1', 'subtotal'),
  line('fees_reductions', 'Total Offsets, Waivers & Rebates (Applied During Period)', 'A.1', 'subtotal'),
  line('fees_net', 'Total Fees & Expenses: Net of Offsets, Waivers & Rebates', 'A.1', 'subtotal'),
  line('investment_income_heading', 'Investment Income', 'A.1', 'heading'),
  line('interest_income', 'Interest Income', 'A.1', 'input'),
  line('dividend_income', 'Dividend Income', 'A.1', 'input'),
  line('other_investment_income', 'Other Investment Income', 'A.1', 'input'),
  line('total_investment_income', 'Total Investment Income', 'A.1', 'subtotal'),
  line('total_net_operating', 'Total Net Operating Income / (Expense)', 'A.1', 'subtotal'),
  line('net_realized_gain', 'Net Realized Gain / (Loss)', 'A.1', 'input'),
  line('net_unrealized_gain', 'Net Unrealized Gain / (Loss)', 'A.1', 'input'),
  line('total_gain', 'Total Net Realized and Unrealized Gain / (Loss)', 'A.1', 'subtotal'),
  line('ending_nav', 'Ending NAV – Net of Accrued/Earned/Paid Carried Interest', 'A.1', 'subtotal'),
  line('carry_beginning', 'Accrued/Earned/Paid Carried Interest – Starting Period Balance', 'A.1', 'input'),
  line('carry_accrued', 'Carried Interest Accrued (Unrealized Profits)', 'A.1', 'input'),
  line('carry_earned', 'Carried Interest Earned (Realized Profits, Inclusive of Amount Held in Escrow)', 'A.1', 'input'),
  line('carry_escrow', 'Carried Interest: Amount Held in Escrow – Ending Period Balance', 'A.1', 'input'),
  line('carry_total', 'Carried Interest Accrued/Earned (Total)', 'A.1', 'subtotal'),
  line('carry_paid', 'Carried Interest – Paid During the Period (input positive values)', 'A.1', 'input'),
  line('carry_clawback', 'Returned Clawback', 'A.1', 'input'),
  line('carry_ending', 'Accrued/Earned/Paid Carried Interest – Ending Period Balance', 'A.1', 'subtotal'),
  line('ending_nav_gross', 'Ending NAV – Gross of Accrued/Earned/Paid Carried Interest', 'A.1', 'subtotal'),
  // A.2 Commitment reconciliation
  line('total_commitment', 'Total Commitment', 'A.2', 'input'),
  line('beginning_unfunded', 'Beginning Unfunded Commitment', 'A.2', 'input'),
  line('unfunded_contributions', '(Less Contributions)', 'A.2', 'input'),
  line('unfunded_recallable', 'Plus Recallable Distributions', 'A.2', 'input'),
  line('unfunded_released', '(Less Expired/Released Commitments)', 'A.2', 'input'),
  line('unfunded_other', '+/- Other Unfunded Adjustment', 'A.2', 'input'),
  line('ending_unfunded', 'Ending Unfunded Commitment', 'A.2', 'subtotal'),
  // B.1 Fees from portfolio companies
  line('pc_advisory', 'Advisory & Consulting Fees****', 'B.1', 'input'),
  line('pc_broken_deal', 'Broken Deal Fees****', 'B.1', 'input'),
  line('pc_transaction', 'Transaction & Deal Fees****', 'B.1', 'input'),
  line('pc_directors', 'Directors Fees****', 'B.1', 'input'),
  line('pc_monitoring', 'Monitoring Fees****', 'B.1', 'input'),
  line('pc_capital_markets', 'Capital Markets Fees****', 'B.1', 'input'),
  line('pc_arrangement', 'Arrangement Fees****', 'B.1', 'input'),
  line('pc_origination', 'Origination Fees****', 'B.1', 'input'),
  line('pc_other', 'Other Fees*,****', 'B.1', 'input', true),
  line('pc_other_2016', 'Other Fees: 2016 ILPA Reporting Template Value****', 'B.1', 'input'),
  line('pc_fees_total', 'Total Fees with Respect to Portfolio Companies/Investments', 'B.1', 'subtotal'),
  line('pc_reimbursements', 'Total Reimbursements for Travel & Administrative Expenses****', 'B.1', 'input'),
  line('pc_total', 'Total Received by the Investment Adviser & Related Persons', 'B.1', 'subtotal'),
] as const satisfies readonly ReportingLine[]

export type ReportingLineKey = (typeof REPORTING_LINES)[number]['key']

export const REPORTING_LINE: Record<ReportingLineKey, ReportingLine> =
  Object.fromEntries(REPORTING_LINES.map(l => [l.key, l])) as Record<ReportingLineKey, ReportingLine>

/** The three allocations each figure is stated for, as the template heads its columns. */
export const REPORTING_ALLOCATIONS = ['partner', 'fund', 'gp'] as const
export type ReportingAllocation = (typeof REPORTING_ALLOCATIONS)[number]

/** B.1 heads its second and third columns differently from A.1 and A.2. */
export const REPORTING_ALLOCATION_LABEL: Record<ReportingAllocation, { a: string; b: string }> = {
  partner: { a: "{partner}'s Allocation of Total Fund", b: "{partner}'s Allocation of Total Fund" },
  fund: { a: 'Total Fund (incl. GP Allocation)', b: "Cumulative LPs' Allocation of Total Fund" },
  gp: { a: "GP's Allocation of Total Fund", b: 'Affiliated Positions' },
}

export const REPORTING_WINDOWS = ['QTD', 'YTD', 'ITD'] as const
export type ReportingWindow = (typeof REPORTING_WINDOWS)[number]

/**
 * What an income or expense ACCOUNT can carry: the A.1 input lines a posting to it lands on.
 * Contributions, distributions, transfers, the NAV and carry come from the capital accounts, and
 * the offset categories, A.2 and B.1 from their own registers, so none of those are here.
 */
export const ACCOUNT_CATEGORIES = [
  'offering_syndication_costs', 'placement_fees',
  'mgmt_fee_gross', 'mgmt_fee_rebate', 'mgmt_fee_waiver', 'mgmt_fee_offset',
  'related_admin', 'related_it', 'related_legal', 'related_organization', 'related_other', 'related_offset',
  'ext_admin', 'ext_valuation', 'ext_it', 'ext_legal', 'ext_investigation', 'ext_audit', 'ext_tax_prep',
  'ext_organization', 'ext_taxes', 'ext_bank_fees', 'ext_sub_facility_fees', 'ext_sub_facility_interest',
  'ext_other_facility_fees', 'ext_other_facility_interest', 'ext_other_interest', 'ext_custody',
  'ext_due_diligence', 'ext_broken_deals', 'ext_travel', 'ext_insurance', 'ext_portfolio_costs', 'ext_other',
  'ext_offset',
  'interest_income', 'dividend_income', 'other_investment_income',
  'net_realized_gain', 'net_unrealized_gain',
] as const satisfies readonly ReportingLineKey[]
export type AccountCategory = (typeof ACCOUNT_CATEGORIES)[number]

/** The account categories that reduce a fee or expense: a credit to them is a rebate, waiver or offset. */
export const REDUCTION_CATEGORIES: ReadonlySet<AccountCategory> = new Set<AccountCategory>([
  'mgmt_fee_rebate', 'mgmt_fee_waiver', 'mgmt_fee_offset', 'related_offset', 'ext_offset',
])

/** A short name for each account category, for a picker; the template's own label is REPORTING_LINE[key].label. */
export function accountCategoryName(category: AccountCategory): string {
  return REPORTING_LINE[category].label
    .replace(/ \(input positive values\)$/, '')
    .replace(/^\((.*)\)(\*?)$/, '$1$2')
    .replace(/\*$/, '')
    .replace(/^Less /, '')
    .replace(/^Partnership Expenses – /, '')
    .replace(/^Internal Staff\/Related Persons – /, 'Related persons – ')
}
