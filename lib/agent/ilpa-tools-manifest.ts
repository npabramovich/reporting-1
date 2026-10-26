// Pure metadata for the ILPA tools. NO server imports (the Settings key UI lists these). Handlers
// live in ilpa-tools.ts.
//
// One vehicle's books, so it binds as a ledger tool: the dispatcher resolves the vehicle with the
// caller's access and injects it.
//
//   ilpa_notice_data          → an issued call or declared distribution as the ILPA Capital Call &
//                               Distribution Template (v. 2.0) data, per partner; writes nothing
//   ilpa_reporting_template   → one partner's quarter as the ILPA Reporting Template (v. 2.0);
//                               writes nothing
//
// The mechanics are in lib/lp-templates/ccd-load.ts and lib/lp-templates/reporting-load.ts, the same data the .xlsx
// downloads carry.

import type { AgentToolMeta } from '@/lib/accounting/agent-tools-manifest'

export const ILPA_TOOL_MANIFEST: AgentToolMeta[] = [
  {
    name: 'ilpa_notice_data',
    description:
      "An issued capital call or declared distribution as the data the ILPA Capital Call & Distribution Template " +
      '(v. 2.0) asks for, one notice per partner: the fund and partner blocks (fund size, GP commitment, the partner\'s ' +
      'commitment and percentage), each line under its ILPA transaction type with its impact on unfunded commitment and ' +
      'whether it is inside or outside the fund, cumulative amounts before and including the notice, the unfunded ' +
      'commitment roll, and footnotes. Writes nothing. The same data downloads as .xlsx beside each notice on the ' +
      'capital accounts page.',
    scope: 'read',
    accessDomain: 'lp_capital',
    inputSchema: {
      type: 'object',
      required: ['kind', 'id'],
      properties: {
        kind: { type: 'string', enum: ['capital_call', 'distribution'] },
        id: { type: 'string', description: 'The call or distribution (lp_capital_calls lists calls).' },
        lpEntityId: { type: 'string', description: 'One partner only. Leave out for every partner on the notice.' },
      },
    },
  },
  {
    name: 'ilpa_reporting_template',
    description:
      "One partner's quarter as the ILPA Reporting Template (v. 2.0) states it, for the partner, the whole fund and " +
      'the GP, each QTD, YTD and ITD: the NAV roll-forward with management fees, offsets, waivers, rebates and ' +
      "partnership expenses in ILPA's categories, the unapplied offset roll-forward, the carried interest roll-forward " +
      '(accrued, earned, paid, escrow, clawback), the commitment reconciliation, the fees the adviser received from ' +
      "portfolio companies, a check that each NAV roll ends at the capital on the books, and footnotes. Expense " +
      'accounts with no ILPA category report as "Other": give them one on the chart of accounts. Marked draft when ' +
      'the quarter is not closed. Writes nothing. The same data downloads as .xlsx from the partner\'s capital account.',
    scope: 'read',
    accessDomain: 'lp_capital',
    inputSchema: {
      type: 'object',
      required: ['lpEntityId'],
      properties: {
        lpEntityId: { type: 'string', description: 'The partner (list_lps lists them).' },
        quarterEnd: { type: 'string', description: 'A calendar quarter end, YYYY-03-31, 06-30, 09-30 or 12-31. Defaults to the last quarter ended.' },
      },
    },
  },
]
