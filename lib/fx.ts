import type { InvestmentTransaction } from '@/lib/types/database'

// ---------------------------------------------------------------------------
// FX revaluation
//
// Rate convention: a rate is fund-currency units per one unit of the deal's
// original currency, so `fundAmount = originalAmount * rate`. A EUR deal held
// by a USD-reporting fund at "1 EUR = 1.10 USD" has a rate of 1.10.
// ---------------------------------------------------------------------------

export interface FxRevaluationInput {
  /** Position value in the original currency. Held constant across the reval. */
  positionValueOriginal: number
  /** Rate the position was previously carried at. */
  priorRate: number
  /** Rate as of this transaction's date. */
  newRate: number
  /** Share price in the original currency, if the position is priced equity. */
  localSharePrice?: number | null
}

export interface FxRevaluationResult {
  priorFundValue: number
  newFundValue: number
  /** Fund-currency gain (+) or loss (-) caused purely by the rate move. */
  fxValueChange: number
  /** Fund-currency share price at the new rate, or null when not priced equity. */
  newFundSharePrice: number | null
}

export function computeFxRevaluation({
  positionValueOriginal,
  priorRate,
  newRate,
  localSharePrice,
}: FxRevaluationInput): FxRevaluationResult {
  const priorFundValue = positionValueOriginal * priorRate
  const newFundValue = positionValueOriginal * newRate

  return {
    priorFundValue,
    newFundValue,
    fxValueChange: newFundValue - priorFundValue,
    newFundSharePrice:
      localSharePrice != null && localSharePrice > 0 ? localSharePrice * newRate : null,
  }
}

/**
 * The columns an FX revaluation writes. The rate move is the only input; every
 * fund-currency figure here is derived from it.
 *
 * Both `unrealized_value_change` and `current_share_price` are set because
 * computeSummary reads a different one depending on the round: priced-equity
 * rounds take FMV from share price and ignore the value change, while
 * convertibles do the reverse. Setting both means the mark lands either way,
 * and neither round type double-counts.
 */
export interface FxRevaluationPayload {
  valuation_change_source: 'fx'
  original_currency: string
  fx_rate: number
  prior_fx_rate: number
  original_position_value: number
  fx_value_change: number
  unrealized_value_change: number
  original_unrealized_value_change: number
  current_share_price: number | null
  original_current_share_price: number | null
}

export function buildFxRevaluationPayload({
  currency,
  positionValueOriginal,
  priorRate,
  newRate,
  localSharePrice,
}: FxRevaluationInput & { currency: string }): FxRevaluationPayload {
  const result = computeFxRevaluation({
    positionValueOriginal,
    priorRate,
    newRate,
    localSharePrice,
  })

  return {
    valuation_change_source: 'fx',
    original_currency: currency,
    fx_rate: newRate,
    prior_fx_rate: priorRate,
    original_position_value: positionValueOriginal,
    fx_value_change: result.fxValueChange,
    // The authoritative fund-currency number every downstream consumer reads.
    unrealized_value_change: result.fxValueChange,
    // The position did not move in its own currency — only the rate did.
    original_unrealized_value_change: 0,
    current_share_price: result.newFundSharePrice,
    original_current_share_price: localSharePrice ?? null,
  }
}

// ---------------------------------------------------------------------------
// Deriving prefill values from a company's existing transactions
// ---------------------------------------------------------------------------

/**
 * Fund-currency / original-currency column pairs whose ratio implies the rate
 * that was in force when a transaction was booked. Ordered most- to
 * least-specific: a mark's current share price beats an old round's cost basis.
 */
const IMPLIED_RATE_PAIRS: ReadonlyArray<
  readonly [keyof InvestmentTransaction, keyof InvestmentTransaction]
> = [
  ['current_share_price', 'original_current_share_price'],
  ['share_price', 'original_share_price'],
  ['investment_cost', 'original_investment_cost'],
  ['proceeds_received', 'original_proceeds_received'],
]

function impliedRate(txn: InvestmentTransaction): number | null {
  if (txn.fx_rate != null && txn.fx_rate > 0) return txn.fx_rate

  for (const [fundKey, originalKey] of IMPLIED_RATE_PAIRS) {
    const fund = txn[fundKey] as number | null
    const original = txn[originalKey] as number | null
    if (fund != null && fund > 0 && original != null && original > 0) {
      return fund / original
    }
  }
  return null
}

/** Most recent first. Transactions without a date sort last. */
function byDateDesc(a: InvestmentTransaction, b: InvestmentTransaction): number {
  if (!a.transaction_date) return 1
  if (!b.transaction_date) return -1
  return b.transaction_date.localeCompare(a.transaction_date)
}

function candidates(
  transactions: InvestmentTransaction[],
  currency: string,
  excludeId?: string | null
): InvestmentTransaction[] {
  return transactions
    .filter(t => t.original_currency === currency && t.id !== excludeId)
    .sort(byDateDesc)
}

/** The currency this company's deal is denominated in, if any. */
export function deriveOriginalCurrency(
  transactions: InvestmentTransaction[],
  excludeId?: string | null
): string | null {
  const withCurrency = transactions
    .filter(t => t.original_currency && t.id !== excludeId)
    .sort(byDateDesc)
  return withCurrency[0]?.original_currency ?? null
}

/**
 * The rate the position is currently carried at: the explicit `fx_rate` on the
 * latest transaction that has one, else the rate implied by that transaction's
 * fund/original amount pair.
 */
export function derivePriorFxRate(
  transactions: InvestmentTransaction[],
  currency: string,
  excludeId?: string | null
): number | null {
  for (const txn of candidates(transactions, currency, excludeId)) {
    const rate = impliedRate(txn)
    if (rate != null) return rate
  }
  return null
}

/** Latest known share price in the original currency. */
export function deriveLocalSharePrice(
  transactions: InvestmentTransaction[],
  currency: string,
  excludeId?: string | null
): number | null {
  for (const txn of candidates(transactions, currency, excludeId)) {
    if (txn.original_current_share_price != null && txn.original_current_share_price > 0) {
      return txn.original_current_share_price
    }
    if (txn.original_share_price != null && txn.original_share_price > 0) {
      return txn.original_share_price
    }
  }
  return null
}

/**
 * Back-convert a fund-currency carrying value into the original currency at the
 * rate it is carried at — the base a rate move is applied to.
 */
export function deriveOriginalPositionValue(
  fundCurrencyValue: number,
  priorRate: number
): number | null {
  if (priorRate <= 0) return null
  return fundCurrencyValue / priorRate
}

/** Rates are quoted to 4dp; enough for every major pair without false precision. */
export function formatFxRate(rate: number | null | undefined): string {
  if (rate == null) return '-'
  return rate.toFixed(4)
}
