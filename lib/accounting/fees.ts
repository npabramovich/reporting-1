// Management fee engine.
//
// fee_i = basisAmount_i × effectiveRate_i × periodFraction, where the effective
// rate honors per-LP side letters (rateOverride) and exemptions (GP/employee
// vehicles that pay no fee). The basis is chosen by the caller — committed
// capital during the investment period, invested capital or NAV after — by
// supplying each LP's basisAmount consistently.

export type FeeBasis = 'committed' | 'invested' | 'nav'

export interface FeeTerms {
  /** Annual rate as a decimal, e.g. 0.02 = 2%. */
  annualRate: number
  basis: FeeBasis
  /** Fraction of a year this charge covers, e.g. 0.25 for a quarter. */
  periodFraction: number
}

export interface FeeOwner {
  lpEntityId: string
  /** Basis amount for this LP (committed / invested / nav) in currency. */
  basisAmount: number
  /** Per-LP annual rate override (side letter). Omit to use the default. */
  rateOverride?: number | null
  /** GP / employee vehicles etc. that pay no management fee. */
  exempt?: boolean
}

export interface FeeLine {
  lpEntityId: string
  basisAmount: number
  rate: number
  fee: number
}

export interface FeeResult {
  lines: FeeLine[]
  total: number
}

function r(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/** Per-LP management fee for a period, respecting side letters and exemptions. */
export function computeManagementFee(terms: FeeTerms, owners: FeeOwner[]): FeeResult {
  const lines: FeeLine[] = owners.map(o => {
    const rate = o.exempt ? 0 : (o.rateOverride ?? terms.annualRate)
    const fee = r(Math.max(0, o.basisAmount) * rate * terms.periodFraction)
    return { lpEntityId: o.lpEntityId, basisAmount: o.basisAmount, rate, fee }
  })
  const total = r(lines.reduce((s, l) => s + l.fee, 0))
  return { lines, total }
}
