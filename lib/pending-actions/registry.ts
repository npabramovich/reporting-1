import type { Domain } from '@/lib/access/domains'
import type { FeatureKey } from '@/lib/types/features'
import type { ActionType, ActionDeps, PreviewResult } from './types'
import { previewMetricValue, writeMetricValue } from './metric-value'
import { previewRecordInvestment, executeRecordInvestment } from './investment'
import { previewIssueCapitalCall, executeIssueCapitalCall } from './capital-call'

/**
 * One write action the Analyst may DRAFT. Each maps to the access `domain` (+ optional feature)
 * that gates it, a JSON Schema the model fills in, a read-only `preview`, and the real `execute`
 * that runs only on human approval. `domain`/`accessFeature` are the authorization answer: drafting
 * needs `read`, approving needs `write` (enforced in the approval endpoint).
 */
export interface WriteAction {
  domain: Domain
  accessFeature?: FeatureKey
  description: string
  inputSchema: Record<string, unknown>
  preview: (deps: ActionDeps, input: any) => Promise<PreviewResult>
  execute: (deps: ActionDeps, input: any) => Promise<Record<string, unknown>>
}

export const WRITE_ACTIONS: Record<ActionType, WriteAction> = {
  update_company_metric: {
    domain: 'portfolio',
    description: 'Set or update a portfolio company metric value for a specific period.',
    inputSchema: {
      type: 'object',
      required: ['companyId', 'metricId', 'period_label', 'period_year', 'value'],
      properties: {
        companyId: { type: 'string', description: 'The company id.' },
        metricId: { type: 'string', description: 'The metric id.' },
        period_label: { type: 'string', description: 'Human label for the period, e.g. "Q2 2026".' },
        period_year: { type: 'number' },
        period_quarter: { type: 'number', description: 'Quarter 1-4, omit for annual/monthly.' },
        period_month: { type: 'number', description: 'Month 1-12, omit for quarterly/annual.' },
        value: { type: ['number', 'string'], description: 'The metric value (number, or text for text metrics).' },
        notes: { type: 'string' },
      },
    },
    preview: previewMetricValue,
    execute: writeMetricValue,
  },
  record_investment: {
    domain: 'portfolio',
    accessFeature: 'investments',
    description:
      'Record a portfolio transaction (investment | unrealized_gain_change | proceeds | round_info). ' +
      'Drafts the journal entry it implies for review; set converts_from_txn_id to link a SAFE/note conversion.',
    inputSchema: {
      type: 'object',
      required: ['company', 'transaction_type', 'transaction_date'],
      properties: {
        company: { type: 'string', description: 'Company id or name.' },
        vehicle: { type: 'string', description: 'The vehicle (portfolio_group). Required for the ledger draft.' },
        transaction_type: { type: 'string', enum: ['investment', 'unrealized_gain_change', 'proceeds', 'round_info'] },
        transaction_date: { type: 'string', description: 'YYYY-MM-DD.' },
        round_name: { type: 'string' },
        notes: { type: 'string' },
        investment_cost: { type: 'number' },
        shares_acquired: { type: 'number' },
        share_price: { type: 'number' },
        unrealized_value_change: { type: 'number' },
        current_share_price: { type: 'number' },
        cost_basis_exited: { type: 'number' },
        proceeds_received: { type: 'number' },
        converts_from_txn_id: { type: 'string', description: 'Prior SAFE/note transaction this priced round converts.' },
      },
    },
    preview: previewRecordInvestment,
    execute: executeRecordInvestment,
  },
  issue_capital_call: {
    domain: 'lp_capital',
    description: 'Issue a fund-wide capital call, split across LPs pro-rata by commitment.',
    inputSchema: {
      type: 'object',
      required: ['callDate', 'total'],
      properties: {
        vehicle: { type: 'string', description: 'The vehicle (portfolio_group).' },
        callDate: { type: 'string', description: 'YYYY-MM-DD.' },
        description: { type: 'string' },
        total: { type: 'number', description: 'Fund-wide amount to split pro-rata by commitment.' },
      },
    },
    preview: previewIssueCapitalCall,
    execute: executeIssueCapitalCall,
  },
}

export function getWriteAction(name: string): WriteAction | undefined {
  return (WRITE_ACTIONS as Record<string, WriteAction>)[name]
}
