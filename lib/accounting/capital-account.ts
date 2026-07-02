// Capital-account roll-forward — the core fund-accounting artifact.
//
// Each LP's capital account is one equity account; the roll-forward lines come
// from the source_type of the entries that touch it. LP capital is credit-normal,
// so a posting's contribution to capital is the NEGATED signed amount (a credit,
// which is negative in debit-positive convention, increases capital).
//
//   ending = beginning + contributions + distributions + fees + expenses + gains + other
//
// contributions are positive; distributions/fees/expenses are negative; gains are
// signed. `ending` is computed as the raw sum so it always ties to the ledger,
// independent of how lines are bucketed.

export type RollForwardBucket =
  | 'beginning'
  | 'contributions'
  | 'distributions'
  | 'managementFees'
  | 'expenses'
  | 'gains'
  | 'other'

/** Map a journal entry source_type to a roll-forward line. */
export function bucketForSourceType(sourceType: string | null | undefined): RollForwardBucket {
  switch (sourceType) {
    case 'opening_balance':
      return 'beginning'
    case 'capital_call':
    case 'contribution':
      return 'contributions'
    case 'distribution':
      return 'distributions'
    case 'fee':
    case 'management_fee':
      return 'managementFees'
    case 'expense':
    case 'partnership_expense':
    case 'organizational_expense':
      return 'expenses'
    case 'income':
    case 'realized_gain':
    case 'unrealized':
    case 'valuation':
    case 'gain':
      return 'gains'
    default:
      return 'other'
  }
}

export interface CapitalPosting {
  lpEntityId: string
  /** Signed, debit-positive posting amount to the LP's equity account. */
  amount: number
  sourceType?: string | null
}

export interface CapitalAccount {
  beginning: number
  contributions: number
  distributions: number
  managementFees: number
  expenses: number
  gains: number
  other: number
  ending: number
}

function emptyAccount(): CapitalAccount {
  return {
    beginning: 0,
    contributions: 0,
    distributions: 0,
    managementFees: 0,
    expenses: 0,
    gains: 0,
    other: 0,
    ending: 0,
  }
}

const BUCKET_FIELD: Record<RollForwardBucket, keyof CapitalAccount> = {
  beginning: 'beginning',
  contributions: 'contributions',
  distributions: 'distributions',
  managementFees: 'managementFees',
  expenses: 'expenses',
  gains: 'gains',
  other: 'other',
}

/** Round to cents to keep the roll-forward free of float drift. */
function r(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/**
 * Build per-LP capital accounts from postings to LP equity accounts. Each
 * account's `ending` equals the raw sum of capital deltas, so it always ties to
 * the ledger regardless of source-type categorization.
 */
export function computeCapitalAccounts(postings: CapitalPosting[]): Map<string, CapitalAccount> {
  const out = new Map<string, CapitalAccount>()
  for (const p of postings) {
    if (!p.lpEntityId) continue
    const acct = out.get(p.lpEntityId) ?? emptyAccount()
    const capitalDelta = -p.amount // credit increases capital
    const field = BUCKET_FIELD[bucketForSourceType(p.sourceType)]
    acct[field] = r(acct[field] + capitalDelta)
    acct.ending = r(acct.ending + capitalDelta)
    out.set(p.lpEntityId, acct)
  }
  return out
}

/** Total fund NAV = sum of every LP's ending capital. */
export function totalNav(accounts: Map<string, CapitalAccount>): number {
  let sum = 0
  for (const a of Array.from(accounts.values())) sum += a.ending
  return r(sum)
}
