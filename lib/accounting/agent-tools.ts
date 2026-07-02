// Agent tool registry — the single definition of every ledger operation an agent
// can perform, with a JSON-Schema input contract and a handler. Both the MCP
// endpoint and the plain REST agent endpoint dispatch through this list, so the
// tool surface is identical however an agent connects.

import type { SupabaseClient } from '@supabase/supabase-js'
import { DEFAULT_CHART } from './chart'
import { loadPostedLedger, loadEntityNames, loadOwnership } from './load'
import { accountIdByCode, persistEntry } from './persist'
import { computeCapitalAccounts, totalNav } from './capital-account'
import { trialBalance, balanceSheet, incomeStatement } from './statements'
import { reconcileCapital, type AdminCapitalAccount } from './reconcile'
import { runWaterfall } from './waterfall'
import { buildAllocationEntry, type AllocationBody } from './allocation-actions'
import type { JournalEntry, Posting } from './types'

export interface AgentToolContext {
  admin: SupabaseClient
  fundId: string
  userId: string | null
}

export interface AgentTool {
  name: string
  description: string
  scope: 'read' | 'write'
  inputSchema: Record<string, any>
  handler: (ctx: AgentToolContext, input: any) => Promise<any>
}

const EMPTY_SCHEMA = { type: 'object', properties: {}, additionalProperties: false }

const ALLOCATION_ACTIONS = ['management_fee', 'expense', 'gain', 'distribution', 'carry', 'close_period']

export const AGENT_TOOLS: AgentTool[] = [
  {
    name: 'list_accounts',
    description: "List the fund's chart of accounts (code, name, type).",
    scope: 'read',
    inputSchema: EMPTY_SCHEMA,
    handler: async ({ admin, fundId }) => {
      const { accounts } = await loadPostedLedger(admin, fundId)
      return accounts.map(a => ({ code: a.code, name: a.name, type: a.type, subtype: a.subtype ?? null }))
    },
  },
  {
    name: 'seed_chart',
    description: 'Seed the default venture-fund chart of accounts (no-op if any account exists).',
    scope: 'write',
    inputSchema: EMPTY_SCHEMA,
    handler: async ({ admin, fundId }) => {
      const { count } = await admin.from('chart_of_accounts' as any).select('id', { count: 'exact', head: true }).eq('fund_id', fundId)
      if ((count ?? 0) > 0) return { seeded: 0, message: 'Chart already exists' }
      const rows = DEFAULT_CHART.map(a => ({ fund_id: fundId, code: a.code, name: a.name, type: a.type, subtype: a.subtype ?? null }))
      const { data, error } = await admin.from('chart_of_accounts' as any).insert(rows).select('code')
      if (error) throw new Error(error.message)
      return { seeded: (data as any[])?.length ?? 0 }
    },
  },
  {
    name: 'list_entities',
    description: 'List LP entities with committed capital.',
    scope: 'read',
    inputSchema: EMPTY_SCHEMA,
    handler: async ({ admin, fundId }) => {
      const [names, ownership] = await Promise.all([loadEntityNames(admin, fundId), loadOwnership(admin, fundId)])
      const commitment = new Map(ownership.map(o => [o.lpEntityId, o.commitment]))
      return Array.from(names.entries()).map(([lpEntityId, name]) => ({ lpEntityId, name, commitment: commitment.get(lpEntityId) ?? 0 }))
    },
  },
  {
    name: 'capital_accounts',
    description: 'Per-LP capital-account roll-forward (beginning, contributions, distributions, fees, gains, ending) plus fund NAV.',
    scope: 'read',
    inputSchema: EMPTY_SCHEMA,
    handler: async ({ admin, fundId }) => {
      const [{ capitalPostings }, names] = await Promise.all([loadPostedLedger(admin, fundId), loadEntityNames(admin, fundId)])
      const accounts = computeCapitalAccounts(capitalPostings)
      const rows = Array.from(accounts.entries()).map(([lpEntityId, account]) => ({ lpEntityId, name: names.get(lpEntityId) ?? lpEntityId, ...account }))
      return { rows, nav: totalNav(accounts) }
    },
  },
  {
    name: 'financial_statements',
    description: 'Trial balance, balance sheet, and income statement derived from posted entries.',
    scope: 'read',
    inputSchema: EMPTY_SCHEMA,
    handler: async ({ admin, fundId }) => {
      const { accounts, postings } = await loadPostedLedger(admin, fundId)
      return {
        trialBalance: trialBalance(accounts, postings),
        balanceSheet: balanceSheet(accounts, postings),
        incomeStatement: incomeStatement(accounts, postings),
      }
    },
  },
  {
    name: 'list_journal',
    description: 'List recent journal entries with their postings.',
    scope: 'read',
    inputSchema: { type: 'object', properties: { limit: { type: 'number', description: 'Max entries (default 100)' } } },
    handler: async ({ admin, fundId }, input) => {
      const limit = Math.min(Number(input?.limit ?? 100), 500)
      const { data } = await admin.from('journal_entries' as any).select('*, journal_postings(*)').eq('fund_id', fundId).order('entry_date', { ascending: false }).limit(limit)
      return data ?? []
    },
  },
  {
    name: 'post_entry',
    description: 'Post a balanced double-entry journal entry. Postings use account codes; amounts are signed (debits positive, credits negative) and MUST sum to zero.',
    scope: 'write',
    inputSchema: {
      type: 'object',
      required: ['entryDate', 'postings'],
      properties: {
        entryDate: { type: 'string', description: 'ISO date YYYY-MM-DD' },
        memo: { type: 'string' },
        sourceType: { type: 'string' },
        status: { type: 'string', enum: ['draft', 'posted'], description: 'default posted' },
        postings: {
          type: 'array',
          items: {
            type: 'object',
            required: ['accountCode', 'amount'],
            properties: {
              accountCode: { type: 'string' },
              amount: { type: 'number', description: 'signed: debit positive, credit negative' },
              currency: { type: 'string', description: 'default USD' },
              lpEntityId: { type: 'string' },
            },
          },
        },
      },
    },
    handler: async ({ admin, fundId, userId }, input) => {
      const codes = await accountIdByCode(admin, fundId)
      const postings: Posting[] = (input.postings ?? []).map((p: any) => {
        const accountId = p.accountId ?? codes.get(p.accountCode)
        if (!accountId) throw new Error(`Unknown account code ${p.accountCode}`)
        return { accountId, amount: Number(p.amount), currency: p.currency ?? 'USD', lpEntityId: p.lpEntityId ?? null }
      })
      const entry: JournalEntry = { fundId, entryDate: input.entryDate, memo: input.memo ?? null, sourceType: input.sourceType ?? 'manual', postings }
      const result = await persistEntry(admin, fundId, userId, entry, input.status === 'draft' ? 'draft' : 'posted')
      if ('error' in result) throw new Error(result.error)
      return { entryId: result.entryId }
    },
  },
  {
    name: 'allocation',
    description: 'Compute and post a period allocation or period close: management_fee, expense, gain, distribution, carry, or close_period.',
    scope: 'write',
    inputSchema: {
      type: 'object',
      required: ['action', 'entryDate'],
      properties: {
        action: { type: 'string', enum: ALLOCATION_ACTIONS },
        entryDate: { type: 'string' },
        memo: { type: 'string' },
        annualRate: { type: 'number', description: 'management_fee: decimal, e.g. 0.02' },
        periodFraction: { type: 'number', description: 'management_fee: e.g. 0.25 for a quarter' },
        amount: { type: 'number', description: 'expense / gain total' },
        overrides: { type: 'object', description: 'management_fee: per-LP { rateOverride, exempt }' },
        perLp: { type: 'object', description: 'distribution / carry: { lpEntityId: amount }' },
        post: { type: 'boolean', description: 'default true; false returns a preview' },
      },
    },
    handler: async ({ admin, fundId, userId }, input) => {
      const built = await buildAllocationEntry(admin, fundId, input as AllocationBody)
      if ('error' in built) throw new Error(built.error)
      if (input.post === false) return { preview: built.entry }
      const result = await persistEntry(admin, fundId, userId, built.entry, 'posted')
      if ('error' in result) throw new Error(result.error)
      return { entryId: result.entryId, entry: built.entry }
    },
  },
  {
    name: 'reconcile',
    description: "Reconcile the ledger's capital accounts against admin figures. `admin` is { lpEntityId: { ending, ... } }.",
    scope: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        admin: { type: 'object', description: 'per-LP admin capital figures' },
        tolerance: { type: 'number', description: 'default 0.01' },
      },
    },
    handler: async ({ admin, fundId }, input) => {
      const { capitalPostings } = await loadPostedLedger(admin, fundId)
      const ledger = computeCapitalAccounts(capitalPostings)
      const adminMap = new Map<string, AdminCapitalAccount>(Object.entries(input?.admin ?? {}))
      return reconcileCapital(ledger, adminMap, typeof input?.tolerance === 'number' ? input.tolerance : 0.01)
    },
  },
  {
    name: 'run_waterfall',
    description: 'Compute a European carried-interest waterfall for a distribution (pure calc; does not post).',
    scope: 'read',
    inputSchema: {
      type: 'object',
      required: ['distributable', 'terms', 'state'],
      properties: {
        distributable: { type: 'number' },
        terms: { type: 'object', properties: { carryRate: { type: 'number' }, catchUpRate: { type: 'number' } } },
        state: {
          type: 'object',
          properties: {
            contributedCapital: { type: 'number' },
            returnedCapital: { type: 'number' },
            preferredPaid: { type: 'number' },
            preferredTarget: { type: 'number' },
            gpCarryPaid: { type: 'number' },
          },
        },
      },
    },
    handler: async (_ctx, input) => runWaterfall(Number(input.distributable), input.terms, input.state),
  },
]

export function getTool(name: string): AgentTool | undefined {
  return AGENT_TOOLS.find(t => t.name === name)
}
