// The implementation lives in the open fund engine: packages/fund-engine/src/types.ts
// (@portfolio/fund-engine). This module re-exports it so existing imports keep working; change the
// math there, not here.

export {
  NORMAL_SIDE,
} from '@portfolio/fund-engine'
export type {
  AccountType,
  EntryStatus,
  Account,
  Posting,
  JournalEntry,
} from '@portfolio/fund-engine'
