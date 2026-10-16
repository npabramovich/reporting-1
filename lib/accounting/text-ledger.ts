// The implementation lives in the open fund engine: packages/fund-engine/src/text-ledger.ts
// (@hemrock/fund-engine). This module re-exports it so existing imports keep working; change the
// math there, not here.

export {
  textAccountName,
  codeFromAccountName,
  serializeLedger,
  resolvePostingAccounts,
  parseLedgerText,
} from '@hemrock/fund-engine'
export type {
  TextPostingInput,
  TextEntryInput,
  ParsedTextPosting,
  ParsedTextEntry,
  ParseTextResult,
} from '@hemrock/fund-engine'
