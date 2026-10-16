// The implementation lives in the open fund engine: packages/fund-engine/src/allocation.ts
// (@hemrock/fund-engine). This module re-exports it so existing imports keep working; change the
// math there, not here.

export {
  apportionCents,
  allocateAmount,
  allocateAmountCumulatively,
  ownershipFractions,
} from '@hemrock/fund-engine'
export type {
  LpOwnership,
  CumulativeAllocationLine,
} from '@hemrock/fund-engine'
