// The ILPA Performance Template (Granular Methodology, v. 1.1): its transaction types and which
// return each one enters. Pure data, transcribed from the template's "Transaction Type Mapping"
// sheet, so the calculation in performance.ts and anyone checking it read the same table.
//
// Eight returns are stated. Net and gross, IRR and multiple, each with the fund-level subscription
// facility (the cash flows as they happened) and without it (as if the partners had been called on
// the day the line was drawn). Net IRR and net TVPI enter and leave together, and so do gross IRR
// and gross MOIC, so each type is described by four switches and one role in the multiple:
//
//   denominator           paid in: a call or a drawdown (entered as a negative amount)
//   decrease_denominator  paid back out of paid-in: a return of excess capital, or the synthetic
//                         distribution that undoes a call which only repaid the line (positive)
//   numerator             value: a distribution, carry, a quarter-end adjustment or the NAV (positive)
//
// Amounts follow the template: from the partners' side, contributions negative and distributions
// positive.

export const ILPA_PERFORMANCE_VERSION = '1.1'
export const ILPA_PERFORMANCE_METHODOLOGY = 'Granular'

/** The credit every performance file carries: ILPA created the template it follows, and does not endorse this software. */
export const ILPA_PERFORMANCE_ATTRIBUTION =
  `This file follows the ILPA Performance Template (${ILPA_PERFORMANCE_METHODOLOGY} Methodology, v. ${ILPA_PERFORMANCE_VERSION}), ` +
  'created by the Institutional Limited Partners Association (ILPA), with thanks to ILPA for developing it as an industry ' +
  "standard. The template is ILPA's; this software is not affiliated with or endorsed by ILPA."

export const PERFORMANCE_TYPES = [
  'Capital Call: Investments',
  'Capital Call: Management Fees/Partnership Expenses',
  'Capital Call: Working Capital',
  'Fund-level Subscription Facility Drawdown: Investments',
  'Fund-level Subscription Facility Drawdown: Management Fees/Partnership Expenses',
  'Fund-level Subscription Facility Drawdown: Working Capital',
  'Capital Call: Fund-level Subscription Facility Fees/Interest',
  'Synthetic Distribution: Fund-level Subscription Facility Repayment: Investments',
  'Synthetic Distribution: Fund-level Subscription Facility Repayment: Management Fees/Partnership Expenses',
  'Deemed GP Contribution from LPs',
  'Carry / Clawback',
  'Distribution: Permanent',
  'Distribution: Recallable',
  'Distribution: Return of Excess Capital Called: Investments',
  'Distribution: Return of Excess Capital Called: Management Fees/Partnership Expenses',
  'Quarter-end Adjustment for Carry Allocation',
  'Quarter-end Adjustment for Accrued Management Fees/Partnership Expenses',
  'Quarter-end Adjustment for Accrued Fees/Interest from Fund-level Subscription Facility',
  'Gross Up Outstanding Balance from Fund-level Subscription Facility',
  'NAV',
] as const
export type PerformanceType = typeof PERFORMANCE_TYPES[number]

export type MultipleRole = 'denominator' | 'decrease_denominator' | 'numerator'

export interface TypeTreatment {
  withNet: boolean
  withGross: boolean
  withoutNet: boolean
  withoutGross: boolean
  role: MultipleRole
}

const t = (withNet: boolean, withGross: boolean, withoutNet: boolean, withoutGross: boolean, role: MultipleRole): TypeTreatment =>
  ({ withNet, withGross, withoutNet, withoutGross, role })
const ALL = [true, true, true, true] as const
const NET_ONLY = [true, false, true, false] as const
const WITHOUT_ONLY = [false, false, true, true] as const
const GROSS_ONLY = [false, true, false, true] as const

export const TREATMENT: Record<PerformanceType, TypeTreatment> = {
  'Capital Call: Investments': t(...ALL, 'denominator'),
  'Capital Call: Management Fees/Partnership Expenses': t(...NET_ONLY, 'denominator'),
  'Capital Call: Working Capital': t(...ALL, 'denominator'),
  'Fund-level Subscription Facility Drawdown: Investments': t(...WITHOUT_ONLY, 'denominator'),
  'Fund-level Subscription Facility Drawdown: Management Fees/Partnership Expenses': t(false, false, true, false, 'denominator'),
  'Fund-level Subscription Facility Drawdown: Working Capital': t(...WITHOUT_ONLY, 'denominator'),
  'Capital Call: Fund-level Subscription Facility Fees/Interest': t(true, false, false, false, 'denominator'),
  'Synthetic Distribution: Fund-level Subscription Facility Repayment: Investments': t(...WITHOUT_ONLY, 'decrease_denominator'),
  'Synthetic Distribution: Fund-level Subscription Facility Repayment: Management Fees/Partnership Expenses': t(false, false, true, false, 'decrease_denominator'),
  'Deemed GP Contribution from LPs': t(...NET_ONLY, 'denominator'),
  'Carry / Clawback': t(...GROSS_ONLY, 'numerator'),
  'Distribution: Permanent': t(...ALL, 'numerator'),
  'Distribution: Recallable': t(...ALL, 'numerator'),
  'Distribution: Return of Excess Capital Called: Investments': t(...ALL, 'decrease_denominator'),
  'Distribution: Return of Excess Capital Called: Management Fees/Partnership Expenses': t(...NET_ONLY, 'decrease_denominator'),
  'Quarter-end Adjustment for Carry Allocation': t(...GROSS_ONLY, 'numerator'),
  'Quarter-end Adjustment for Accrued Management Fees/Partnership Expenses': t(...GROSS_ONLY, 'numerator'),
  'Quarter-end Adjustment for Accrued Fees/Interest from Fund-level Subscription Facility': t(false, true, true, true, 'numerator'),
  'Gross Up Outstanding Balance from Fund-level Subscription Facility': t(...WITHOUT_ONLY, 'numerator'),
  'NAV': t(...ALL, 'numerator'),
}

/** The four flow sets the template computes returns over. */
export const PERFORMANCE_SERIES = ['withNet', 'withGross', 'withoutNet', 'withoutGross'] as const
export type PerformanceSeries = typeof PERFORMANCE_SERIES[number]

export const SERIES_LABEL: Record<PerformanceSeries, { irr: string; multiple: string }> = {
  withNet: { irr: 'Net IRR - With Impact of Fund-level Subscription Facility', multiple: 'Net TVPI - With Impact of Fund-level Subscription Facility' },
  withGross: { irr: 'Gross IRR - With Impact of Fund-level Subscription Facility', multiple: 'Gross Fund-Level MOIC - With Impact of Fund-level Subscription Facility' },
  withoutNet: { irr: 'Net IRR - Without Impact of Fund-level Subscription Facility', multiple: 'Net TVPI - Without Impact of Fund-level Subscription Facility' },
  withoutGross: { irr: 'Gross IRR - Without Impact of Fund-level Subscription Facility', multiple: 'Gross Fund-Level MOIC - Without Impact of Fund-level Subscription Facility' },
}

/** The sign a type's amount carries: negative for what enters the denominator, positive otherwise. */
export const typeSign = (type: PerformanceType): -1 | 1 => (TREATMENT[type].role === 'denominator' ? -1 : 1)
