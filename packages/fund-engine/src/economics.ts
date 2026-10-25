// From capital postings to the inputs the carry accrual and the distribution waterfall take.
//
// Both the period close and a distribution preview start from the same thing — every posting to a
// partner's capital account — and both treat the carry RECIPIENTS the same way: they receive carry,
// they do not pay it, so their own contributions are outside the hurdle. Keeping that derivation
// here (rather than inline in each loader) is what lets an outside party reproduce the app's
// numbers from an exported ledger.

import { roundCents } from './ledger.ts'
import { bucketForSourceType, computeCapitalAccounts, type CapitalPosting } from './capital-account.ts'
import type { CarryRecipient, DatedContribution, LpEconomics } from './carry.ts'
import type { PartnerEconomics, PriorDistribution } from './distribution-waterfall.ts'

export interface CarryAccrualInputs {
  /** Every non-recipient partner's economics, from the inception-to-date roll-forward. */
  lps: LpEconomics[]
  /** Dated non-recipient contributions, for the preferred return. */
  contributions: DatedContribution[]
  /**
   * Carry already charged to the LPs: what earlier accruals debited from their carriedInterest
   * lines. Not the recipients' balance, which carry PAID has already drawn down.
   */
  alreadyAccrued: number
  /** Every prior distribution as a fund-wide total per date, for an unreturned-capital hurdle. */
  distributions: PriorDistribution[]
}

/**
 * The carry accrual's inputs from capital postings already scoped to the accrual date (the
 * caller passes only postings on or before `asOf`). `asOf` stands in for an undated posting.
 */
export function carryAccrualInputs(
  capitalPostings: CapitalPosting[],
  recipients: CarryRecipient[],
  asOf: string,
): CarryAccrualInputs {
  const recipientIds = new Set(recipients.map(r => r.lpEntityId))
  const accounts = computeCapitalAccounts(capitalPostings)

  // Carry is measured LP-side. Each LP's carriedInterest line holds what earlier accruals charged
  // it (a debit, so negative). The target is what the GP would take from the LPs' value GROSS of
  // carry, so that charge is added back to the balance, and it is also what is already accrued.
  // The recipients' own balance is the wrong figure for the second: carry PAID is drawn from it, so
  // measuring against it would accrue again every dollar already paid out. Passing each LP's charge
  // makes the accrual a true-up: every LP ends at its share of the whole target.
  const charged = (a: { carriedInterest: number }) => roundCents(-a.carriedInterest)
  const lpAccounts = Array.from(accounts.entries()).filter(([id]) => !recipientIds.has(id)) // recipients receive carry; they don't pay it
  const alreadyAccrued = roundCents(lpAccounts.reduce((s, [, a]) => s + charged(a), 0))

  const lps: LpEconomics[] = lpAccounts.map(([lpEntityId, a]) => ({
    lpEntityId,
    contributed: roundCents(a.contributions),
    distributed: roundCents(-a.distributions), // stored negative on the account
    nav: roundCents(a.ending + charged(a)),
    charged: charged(a),
  }))

  // Dated contributions, for the hurdle. The pref accrues from when cash actually arrived.
  const contributions: DatedContribution[] = capitalPostings
    .filter(p => !recipientIds.has(p.lpEntityId ?? '') && bucketForSourceType(p.sourceType, p.amount) === 'contributions')
    .map(p => ({ date: p.entryDate ?? asOf, amount: roundCents(-p.amount) }))
    .filter(c => c.amount > 0)

  const { priors: distributions } = priorDistributions(capitalPostings, recipientIds, asOf)
  return { lps, contributions, alreadyAccrued, distributions }
}

/**
 * Every distribution that left the fund on or before `asOf`, as a fund-wide total per date — LP
 * distributions and carry paid both, because the waterfall is defined over what left — and the
 * carry paid to the recipients.
 */
export function priorDistributions(
  capitalPostings: CapitalPosting[],
  recipientIds: Set<string>,
  asOf: string,
): { priors: PriorDistribution[]; carryPaidToDate: number } {
  const priorByDate = new Map<string, number>()
  let carryPaidToDate = 0
  for (const p of capitalPostings) {
    if (!p.lpEntityId || p.amount <= 0) continue
    const isDist = bucketForSourceType(p.sourceType, p.amount) === 'distributions'
    const isCarry = p.sourceType === 'carry_distribution'
    if (!isDist && !isCarry) continue
    const date = p.entryDate ?? asOf
    if (date > asOf) continue
    priorByDate.set(date, roundCents((priorByDate.get(date) ?? 0) + p.amount))
    if (isCarry && recipientIds.has(p.lpEntityId)) carryPaidToDate = roundCents(carryPaidToDate + p.amount)
  }
  const priors = Array.from(priorByDate.entries()).map(([date, amount]) => ({ date, amount }))
  return { priors, carryPaidToDate }
}

export interface DistributionSplitInputs {
  /** Every partner with a capital account at `asOf`, recipients included. */
  partners: PartnerEconomics[]
  /** Dated non-recipient contributions, for the hurdle. */
  contributions: DatedContribution[]
  /** Every prior distribution (LP distributions and carry paid) as a fund-wide total per date. */
  priors: PriorDistribution[]
  /** Carry actually paid to the recipients to date. */
  carryPaidToDate: number
}

/**
 * The distribution waterfall's inputs from capital postings, as at the distribution date.
 * Postings after `asOf` are ignored.
 */
export function distributionSplitInputs(
  capitalPostings: CapitalPosting[],
  recipients: CarryRecipient[],
  asOf: string,
): DistributionSplitInputs {
  const recipientIds = new Set(recipients.map(r => r.lpEntityId))

  const accounts = computeCapitalAccounts(capitalPostings, { end: asOf })
  const partners: PartnerEconomics[] = Array.from(accounts.entries()).map(([lpEntityId, a]) => ({
    lpEntityId,
    contributed: roundCents(a.contributions),
    distributed: roundCents(-a.distributions),
    ending: roundCents(a.ending),
  }))

  // Dated LP contributions for the hurdle — recipients excluded, as the close excludes them.
  const contributions: DatedContribution[] = capitalPostings
    .filter(p => p.lpEntityId && !recipientIds.has(p.lpEntityId) && bucketForSourceType(p.sourceType, p.amount) === 'contributions')
    .map(p => ({ date: p.entryDate ?? asOf, amount: roundCents(-p.amount) }))
    .filter(c => c.amount > 0)

  const { priors, carryPaidToDate } = priorDistributions(capitalPostings, recipientIds, asOf)

  return { partners, contributions, priors, carryPaidToDate }
}
