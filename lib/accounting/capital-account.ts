// The implementation lives in the open fund engine: packages/fund-engine/src/capital-account.ts
// (@hemrock/fund-engine). This module re-exports it so existing imports keep working; change the
// math there, not here.

export {
  bucketForSourceType,
  ACTIVITY_FIELDS,
  CAPITAL_ACCOUNT_LABELS,
  emptyAccount,
  computeCapitalAccounts,
  totalNav,
  rollForwardTies,
} from '@hemrock/fund-engine'
export type {
  RollForwardBucket,
  CapitalPosting,
  CapitalAccount,
  CapitalPeriod,
} from '@hemrock/fund-engine'
