// A default chart of accounts for a venture fund. Seeded per fund on first use;
// per-LP capital sub-accounts are created separately (they carry lp_entity_id).
// Codes follow the usual 1000/2000/3000/4000/5000 asset/liability/equity/income/
// expense blocks so statements group cleanly.

import type { AccountType } from './types'

export interface ChartAccountSeed {
  code: string
  name: string
  type: AccountType
  subtype?: string
}

export const DEFAULT_CHART: ChartAccountSeed[] = [
  // Assets
  { code: '1000', name: 'Cash', type: 'asset', subtype: 'cash' },
  { code: '1100', name: 'Investments at cost', type: 'asset', subtype: 'investment' },
  { code: '1200', name: 'Unrealized appreciation/(depreciation)', type: 'asset', subtype: 'unrealized' },
  { code: '1300', name: 'Due from LPs', type: 'asset', subtype: 'receivable' },

  // Liabilities
  { code: '2000', name: 'Accrued expenses', type: 'liability', subtype: 'accrued' },
  { code: '2100', name: 'Due to GP', type: 'liability', subtype: 'due_to_gp' },

  // Equity — the GP account; per-LP capital accounts are added with lp_entity_id.
  { code: '3000', name: "Partners' capital — GP", type: 'equity', subtype: 'gp_capital' },
  { code: '3100', name: "Partners' capital — LP (unallocated)", type: 'equity', subtype: 'lp_capital' },
  // Bridge between the P&L (income statement) and partners' capital. Compound
  // fee/expense/income entries park the allocation offset here; the period close
  // zeroes it against the P&L accounts. See lib/accounting/entries.ts.
  { code: '3200', name: 'Undistributed earnings (bridge)', type: 'equity', subtype: 'undistributed_earnings' },

  // Income
  { code: '4000', name: 'Realized gains', type: 'income', subtype: 'realized_gain' },
  { code: '4100', name: 'Interest and dividend income', type: 'income', subtype: 'interest_income' },
  { code: '4200', name: 'Change in unrealized appreciation', type: 'income', subtype: 'unrealized' },

  // Expenses
  { code: '5000', name: 'Management fee', type: 'expense', subtype: 'management_fee' },
  { code: '5100', name: 'Partnership expenses', type: 'expense', subtype: 'partnership_expense' },
  { code: '5200', name: 'Organizational expenses', type: 'expense', subtype: 'organizational_expense' },
]

/** The per-LP capital account code for an entity, e.g. 3100-<entity>. */
export function lpCapitalCode(lpEntityId: string): string {
  return `3100-${lpEntityId.slice(0, 8)}`
}
