// The implementation lives in the open fund engine: packages/fund-engine/src/waterfall.ts
// (@portfolio/fund-engine). This module re-exports it so existing imports keep working; change the
// math there, not here.

export {
  runWaterfall,
} from '@portfolio/fund-engine'
export type {
  WaterfallTerms,
  WaterfallState,
  WaterfallResult,
} from '@portfolio/fund-engine'
