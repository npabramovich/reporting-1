// The source types a journal entry can carry. Shared by the AI paths that have to
// pick one (the assistant when drafting from a document, the bank categorizer) so
// they can't drift apart.

export const ENTRY_SOURCE_TYPES = [
  'capital_call',
  'distribution',
  'management_fee',
  'partnership_expense',
  'organizational_expense',
  'realized_gain',
  'income',
  'valuation',
  // The rate moved, not the company. Kept apart from `valuation` so the close allocates
  // it as its own line and it never masquerades as investment performance.
  'fx_revaluation',
  'opening_balance',
  'manual',
]
