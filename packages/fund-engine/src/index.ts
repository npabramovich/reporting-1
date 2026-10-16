// @hemrock/fund-engine — the pure fund-accounting math behind Hemrock Portfolio.
//
// No database, no framework, no runtime dependencies. Every function here is a function of its
// arguments, so a number the app shows can be reproduced from the books it was computed from.

export * from './types.ts'
export {
  roundCents,
  entryImbalance,
  isBalanced,
  assertBalanced,
  accountBalances,
  normalBalance,
  capitalByEntity,
  simpleEntry,
} from './ledger.ts'
export * from './trial-balance.ts'
export * from './capital-account.ts'
export * from './allocation.ts'
export * from './waterfall.ts'
export * from './carry.ts'
export * from './american-carry.ts'
export * from './distribution-waterfall.ts'
export * from './economics.ts'
export * from './text-ledger.ts'
export * from './xirr.ts'
export * from './books.ts'
export * from './terms-file.ts'
export { runCli, statementsReport, waterfallReport, statementsTable, waterfallTable, USAGE } from './cli.ts'
export type { CliResult, ReadText, StatementsReport, WaterfallReport } from './cli.ts'
