// The implementation lives in the open fund engine: packages/fund-engine/src/capital-account.ts
// (@portfolio/fund-engine). This module re-exports it so existing imports keep working; change the
// math there, not here.

export {
  bucketForSourceType,
  ACTIVITY_FIELDS,
  CAPITAL_ACCOUNT_LABELS,
  emptyAccount,
  computeCapitalAccounts,
  totalNav,
  rollForwardTies,
  recontributedByLp,
  RECYCLED_PROCEEDS_SOURCE,
} from '@portfolio/fund-engine'
export type {
  RollForwardBucket,
  CapitalPosting,
  CapitalAccount,
  CapitalPeriod,
} from '@portfolio/fund-engine'
