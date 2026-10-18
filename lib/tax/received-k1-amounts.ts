// The amounts on a K-1 RECEIVED from a fund this vehicle holds (a "lower-tier" K-1).
//
// received-k1s.ts tracks whether each holding's K-1 has arrived. This is what it says: the Part III
// boxes an investing fund actually receives, and Item L as the underlying fund reported it. Pure —
// the column mapping, the input parsing and the checks a typed-in form needs. The tax-book entries
// derived from these live in lib/accounting/k1-passthrough.ts.
//
// SIGNS AS PRINTED ON THE FORM. Income and gain boxes are signed (a loss is negative). Deductions
// (boxes 12 and 13) and distributions (box 19) are entered as the positive amounts the form shows,
// and so are Item L withdrawals. Translating to debits and credits is the derivation's job, not the
// person typing from the PDF.

export type ReceivedK1AmountKey =
  | 'ordinaryBusinessIncome'
  | 'netRentalRealEstate'
  | 'otherNetRental'
  | 'guaranteedPayments'
  | 'interest'
  | 'ordinaryDividends'
  | 'qualifiedDividends'
  | 'royalties'
  | 'shortTermGain'
  | 'longTermGain'
  | 'section1231Gain'
  | 'otherIncome'
  | 'section179'
  | 'investmentInterest'
  | 'otherDeductions'
  | 'distributionsCash'
  | 'distributionsProperty'
  | 'capitalBeginning'
  | 'capitalContributed'
  | 'capitalCurrentYearIncome'
  | 'capitalOtherIncrease'
  | 'capitalWithdrawals'
  | 'capitalEnding'

export interface ReceivedK1Field {
  key: ReceivedK1AmountKey
  /** The column on received_k1s (20261018181000_received_k1_amounts.sql). */
  column: string
  /** The box as printed: '1', '6b', '13H'. Item L lines carry 'L'. */
  box: string
  label: string
  part: 'income' | 'deduction' | 'distribution' | 'capital'
}

/** Every field, in the order the form prints them. One list, so the form, the API and the agent agree. */
export const RECEIVED_K1_FIELDS: ReceivedK1Field[] = [
  { key: 'ordinaryBusinessIncome', column: 'box1_ordinary_business', box: '1', label: 'Ordinary business income (loss)', part: 'income' },
  { key: 'netRentalRealEstate', column: 'box2_net_rental_real_estate', box: '2', label: 'Net rental real estate income (loss)', part: 'income' },
  { key: 'otherNetRental', column: 'box3_other_net_rental', box: '3', label: 'Other net rental income (loss)', part: 'income' },
  { key: 'guaranteedPayments', column: 'box4_guaranteed_payments', box: '4', label: 'Guaranteed payments', part: 'income' },
  { key: 'interest', column: 'box5_interest', box: '5', label: 'Interest income', part: 'income' },
  { key: 'ordinaryDividends', column: 'box6a_ordinary_dividends', box: '6a', label: 'Ordinary dividends', part: 'income' },
  { key: 'qualifiedDividends', column: 'box6b_qualified_dividends', box: '6b', label: 'Qualified dividends (included in 6a)', part: 'income' },
  { key: 'royalties', column: 'box7_royalties', box: '7', label: 'Royalties', part: 'income' },
  { key: 'shortTermGain', column: 'box8_net_short_term_gain', box: '8', label: 'Net short-term capital gain (loss)', part: 'income' },
  { key: 'longTermGain', column: 'box9a_net_long_term_gain', box: '9a', label: 'Net long-term capital gain (loss)', part: 'income' },
  { key: 'section1231Gain', column: 'box10_net_1231_gain', box: '10', label: 'Net section 1231 gain (loss)', part: 'income' },
  { key: 'otherIncome', column: 'box11_other_income', box: '11', label: 'Other income (loss)', part: 'income' },
  { key: 'section179', column: 'box12_section_179', box: '12', label: 'Section 179 deduction', part: 'deduction' },
  { key: 'investmentInterest', column: 'box13_investment_interest', box: '13H', label: 'Investment interest expense', part: 'deduction' },
  { key: 'otherDeductions', column: 'box13_other_deductions', box: '13', label: 'Other deductions (all other box 13 codes)', part: 'deduction' },
  { key: 'distributionsCash', column: 'box19a_distributions_cash', box: '19A', label: 'Distributions — cash and marketable securities', part: 'distribution' },
  { key: 'distributionsProperty', column: 'box19c_distributions_property', box: '19C', label: 'Distributions — other property', part: 'distribution' },
  { key: 'capitalBeginning', column: 'capital_beginning', box: 'L', label: 'Beginning capital account', part: 'capital' },
  { key: 'capitalContributed', column: 'capital_contributed', box: 'L', label: 'Capital contributed during the year', part: 'capital' },
  { key: 'capitalCurrentYearIncome', column: 'capital_current_year_income', box: 'L', label: 'Current year net income (loss)', part: 'capital' },
  { key: 'capitalOtherIncrease', column: 'capital_other_increase', box: 'L', label: 'Other increase (decrease)', part: 'capital' },
  { key: 'capitalWithdrawals', column: 'capital_withdrawals', box: 'L', label: 'Withdrawals and distributions', part: 'capital' },
  { key: 'capitalEnding', column: 'capital_ending', box: 'L', label: 'Ending capital account', part: 'capital' },
]

export type ReceivedK1Amounts = Partial<Record<ReceivedK1AmountKey, number>>

const FIELD_BY_KEY = new Map(RECEIVED_K1_FIELDS.map(f => [f.key, f]))

/** The amounts on a received_k1s row, or null when none were ever entered. */
export function amountsFromRow(row: Record<string, unknown> | null | undefined): ReceivedK1Amounts | null {
  if (!row || !row.amounts_recorded_at) return null
  const out: ReceivedK1Amounts = {}
  for (const f of RECEIVED_K1_FIELDS) {
    const v = row[f.column]
    if (v === null || v === undefined || v === '') continue
    const n = Number(v)
    if (Number.isFinite(n)) out[f.key] = n
  }
  return out
}

/** The columns to write for a set of amounts. Every field is written, so a box cleared on the form clears. */
export function rowFromAmounts(amounts: ReceivedK1Amounts): Record<string, number | null> {
  const out: Record<string, number | null> = {}
  for (const f of RECEIVED_K1_FIELDS) {
    const v = amounts[f.key]
    out[f.column] = typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 100) / 100 : null
  }
  return out
}

/**
 * Parse amounts from a request body or a tool call.
 *
 * Unknown keys are refused rather than dropped: a typo in "shortTermGains" would otherwise save a
 * K-1 with its capital gain silently missing, and the derived entries would look complete.
 */
export function parseReceivedK1Amounts(raw: unknown): { amounts: ReceivedK1Amounts } | { error: string } {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { error: 'amounts must be an object keyed by box, e.g. { "interest": 1000 }' }
  }
  const amounts: ReceivedK1Amounts = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const field = FIELD_BY_KEY.get(k as ReceivedK1AmountKey)
    if (!field) {
      return { error: `Unknown K-1 amount "${k}". Use one of: ${RECEIVED_K1_FIELDS.map(f => f.key).join(', ')}.` }
    }
    if (v === null || v === undefined || v === '') continue
    const n = typeof v === 'number' ? v : Number(String(v).replace(/[,\s]/g, ''))
    if (!Number.isFinite(n)) return { error: `${field.label} (box ${field.box}) is not a number.` }
    if (Math.abs(n) >= 1e13) return { error: `${field.label} (box ${field.box}) is out of range.` }
    amounts[field.key] = n
  }
  return { amounts }
}

/**
 * Checks that make a set of amounts unusable as typed, each worded for the person at the form.
 *
 * Refused, not repaired: qualified dividends above ordinary dividends is a keying error, and
 * posting either reading of it would put a wrong number on every partner's K-1.
 */
export function receivedK1AmountProblems(a: ReceivedK1Amounts): string[] {
  const problems: string[] = []
  const q = a.qualifiedDividends ?? 0
  const o = a.ordinaryDividends ?? 0
  if (q !== 0 && (Math.sign(q) !== Math.sign(o) || Math.abs(q) > Math.abs(o) + 0.005)) {
    problems.push('Qualified dividends (6b) are part of ordinary dividends (6a) and cannot exceed them.')
  }
  for (const key of ['section179', 'investmentInterest', 'otherDeductions', 'distributionsCash', 'distributionsProperty', 'capitalWithdrawals'] as const) {
    if ((a[key] ?? 0) < 0) {
      const f = FIELD_BY_KEY.get(key)!
      problems.push(`${f.label} (box ${f.box}) is entered as a positive amount, as the form shows it.`)
    }
  }
  return problems
}

/**
 * Does Item L foot as reported? beginning + contributed + income + other − withdrawals = ending.
 *
 * Reported, never forced: a K-1 whose Item L does not foot was most likely mis-keyed, and the
 * person entering it is the one who can tell.
 */
export function itemLVariance(a: ReceivedK1Amounts): number | null {
  if (a.capitalEnding === undefined || a.capitalBeginning === undefined) return null
  const expected =
    (a.capitalBeginning ?? 0) + (a.capitalContributed ?? 0) + (a.capitalCurrentYearIncome ?? 0) +
    (a.capitalOtherIncrease ?? 0) - (a.capitalWithdrawals ?? 0)
  return Math.round((a.capitalEnding - expected) * 100) / 100
}
