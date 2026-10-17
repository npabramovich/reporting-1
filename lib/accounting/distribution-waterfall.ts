// The implementation lives in the open fund engine: packages/fund-engine/src/distribution-waterfall.ts
// (@hemrock/fund-engine). This module re-exports it so existing imports keep working; change the
// math there, not here.

export {
  ZERO_TIERS,
  replayWaterfallState,
  splitDistribution,
  suggestedCharacter,
} from '@hemrock/fund-engine'
export type {
  PartnerEconomics,
  PriorDistribution,
  SplitMethod,
  WaterfallTiers,
  DistributionSplit,
  SplitInput,
} from '@hemrock/fund-engine'
