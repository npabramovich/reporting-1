// The sample fund behind examples/books.ledger: its chart and journal, in the shapes the app's
// exporter hands to serializeLedger. A test pins the checked-in ledger to serializeLedger's output
// for this data, so the example is exactly what `export_ledger_text` would produce for these books.

import type { Account } from '../src/types.ts'
import type { TextEntryInput } from '../src/text-ledger.ts'

const LP_A = 'aaaaaaaa-1111-4111-8111-111111111111'
const LP_B = 'bbbbbbbb-2222-4222-8222-222222222222'
const GP = 'c0ffee00-3333-4333-8333-333333333333'

const acct = (id: string, code: string, name: string, type: Account['type'], lpEntityId: string | null = null): Account =>
  ({ id, fundId: 'sample', code, name, type, lpEntityId })

export const sampleAccounts: Account[] = [
  acct('cash', '1000', 'Cash', 'asset'),
  acct('cost-acme', '1100-acme0001', 'Acme Robotics', 'asset'),
  acct('unreal-acme', '1200-acme0001', 'Acme Robotics unrealized', 'asset'),
  acct('due-from-lps', '1300', 'Due from LPs', 'asset'),
  acct('accrued', '2000', 'Accrued expenses', 'liability'),
  acct('dist-payable', '2300', 'Distributions payable', 'liability'),
  acct('cap-a', `3100-${LP_A.slice(0, 8)}`, "Partners' capital — Alpha Pension", 'equity', LP_A),
  acct('cap-b', `3100-${LP_B.slice(0, 8)}`, "Partners' capital — Beta Family Office", 'equity', LP_B),
  acct('cap-gp', `3100-${GP.slice(0, 8)}`, "Partners' capital — Sample GP", 'equity', GP),
  acct('bridge', '3200', 'Undistributed earnings (bridge)', 'equity'),
  acct('unreal-income', '4200', 'Change in unrealized appreciation', 'income'),
  acct('mgmt-fee', '5000', 'Management fee', 'expense'),
]

const p = (accountId: string, amount: number) => ({ accountId, amount, currency: 'USD' })

export const sampleEntries: TextEntryInput[] = [
  {
    entryDate: '2024-01-15', memo: 'Capital call 1 (50%)', sourceType: 'capital_call', sourceRef: 'call:1', status: 'posted',
    postings: [p('due-from-lps', 500000), p('cap-a', -300000), p('cap-b', -200000)],
  },
  {
    entryDate: '2024-01-31', memo: 'Capital call 1 received', sourceType: 'capital_call', status: 'posted',
    postings: [p('cash', 500000), p('due-from-lps', -500000)],
  },
  {
    entryDate: '2024-02-01', memo: 'Investment in Acme Robotics', sourceType: 'investment', status: 'posted',
    postings: [p('cost-acme', 350000), p('cash', -350000)],
  },
  {
    entryDate: '2024-03-31', memo: 'Q1 management fee', sourceType: 'management_fee', status: 'posted',
    postings: [p('mgmt-fee', 10000), p('cash', -10000), p('cap-a', 6000), p('cap-b', 4000), p('bridge', -10000)],
  },
  {
    entryDate: '2024-12-31', memo: 'Acme Robotics marked to Series B price', sourceType: 'valuation', status: 'posted',
    postings: [p('unreal-acme', 300000), p('unreal-income', -300000), p('bridge', 300000), p('cap-a', -180000), p('cap-b', -120000)],
  },
  {
    entryDate: '2025-06-30', memo: 'Distribution declared', sourceType: 'distribution', status: 'posted',
    postings: [p('cap-a', 60000), p('cap-b', 40000), p('dist-payable', -100000)],
  },
  {
    entryDate: '2025-07-02', memo: 'Distribution paid', sourceType: 'distribution', status: 'posted',
    postings: [p('dist-payable', 100000), p('cash', -100000)],
  },
  {
    entryDate: '2025-09-30', memo: 'Q3 management fee (draft)', sourceType: 'management_fee', status: 'draft',
    postings: [p('mgmt-fee', 10000), p('accrued', -10000)],
  },
]
