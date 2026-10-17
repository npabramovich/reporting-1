// The implementation lives in the open fund engine: packages/fund-engine/src/xirr.ts
// (@hemrock/fund-engine). This module re-exports it so existing imports keep working; change the
// math there, not here.

export {
  xirr,
} from '@hemrock/fund-engine'
export type {
  CashFlow,
} from '@hemrock/fund-engine'
