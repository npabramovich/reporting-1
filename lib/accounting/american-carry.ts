// The implementation lives in the open fund engine: packages/fund-engine/src/american-carry.ts
// (@hemrock/fund-engine). This module re-exports it so existing imports keep working; change the
// math there, not here.

export {
  dealByDealCarry,
} from '@hemrock/fund-engine'
export type {
  DealResult,
  DealCarry,
  DealByDealCarry,
} from '@hemrock/fund-engine'
