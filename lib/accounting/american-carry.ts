// The implementation lives in the open fund engine: packages/fund-engine/src/american-carry.ts
// (@portfolio/fund-engine). This module re-exports it so existing imports keep working; change the
// math there, not here.

export {
  dealByDealCarry,
} from '@portfolio/fund-engine'
export type {
  DealResult,
  DealCarry,
  DealByDealCarry,
} from '@portfolio/fund-engine'
