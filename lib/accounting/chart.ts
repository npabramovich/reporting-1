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
  // A non-USD position moves for two unrelated reasons: the company got more (or less)
  // valuable, and the currency moved. Blending both into 1200/4200 makes "change in
  // unrealized appreciation" report investment performance and currency noise as one
  // number, and no LP can tell which they're looking at. ASC 830 wants them split, so
  // the rate move gets its own asset and its own income line. Carrying value of a
  // position is therefore 1100 + 1200 + 1250.
  { code: '1250', name: 'Foreign currency translation', type: 'asset', subtype: 'fx_translation' },
  { code: '1300', name: 'Due from LPs', type: 'asset', subtype: 'receivable' },

  // Liabilities
  { code: '2000', name: 'Accrued expenses', type: 'liability', subtype: 'accrued' },
  { code: '2100', name: 'Due to GP', type: 'liability', subtype: 'due_to_gp' },
  // Bridge/subscription line or other borrowing used to fund investments ahead of
  // capital calls; repaid as contributions arrive.
  { code: '2200', name: 'Loan payable', type: 'liability', subtype: 'loan_payable' },

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
  // The counterpart to 1250. Kept out of 4200 so the income statement can say how much
  // of the period's gain was the portfolio and how much was the dollar.
  { code: '4300', name: 'Foreign currency translation gain/(loss)', type: 'income', subtype: 'fx_translation' },

  // Expenses
  { code: '5000', name: 'Management fee', type: 'expense', subtype: 'management_fee' },
  { code: '5100', name: 'Partnership expenses', type: 'expense', subtype: 'partnership_expense' },
  { code: '5200', name: 'Organizational expenses', type: 'expense', subtype: 'organizational_expense' },
  { code: '5300', name: 'Interest expense', type: 'expense', subtype: 'interest_expense' },
]

/**
 * Starter chart for a GP / associate entity's own books (a separate vehicle from
 * the fund). Its stake in the fund is an asset carried at capital-account value
 * (equity method); its equity is members' capital; income is carry + its share
 * of fund earnings. Reconciles to the GP's capital account on the fund's books.
 */
export const GP_ENTITY_CHART: ChartAccountSeed[] = [
  // Assets
  { code: '1000', name: 'Cash', type: 'asset', subtype: 'cash' },
  { code: '1500', name: 'Investment in Fund', type: 'asset', subtype: 'investment_in_fund' },
  { code: '1600', name: 'Carried interest receivable', type: 'asset', subtype: 'carry_receivable' },

  // Liabilities
  { code: '2000', name: 'Accrued expenses', type: 'liability', subtype: 'accrued' },

  // Equity
  { code: '3000', name: "Members' capital", type: 'equity', subtype: 'members_capital' },

  // Income
  { code: '4000', name: 'Carried interest income', type: 'income', subtype: 'carried_interest' },
  { code: '4100', name: 'Equity in earnings of Fund', type: 'income', subtype: 'equity_method' },
  { code: '4200', name: 'Management fee income', type: 'income', subtype: 'management_fee_income' },

  // Expenses
  { code: '5000', name: 'Operating expenses', type: 'expense', subtype: 'operating_expense' },
]

/** The per-LP capital account code for an entity, e.g. 3100-<entity>. */
export function lpCapitalCode(lpEntityId: string): string {
  return `3100-${lpEntityId.slice(0, 8)}`
}
