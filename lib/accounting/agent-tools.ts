// Agent tool registry — merges the pure manifest (name/description/scope/schema)
// with server-side handlers. Both the MCP endpoint and the REST agent endpoint
// dispatch through this list, so the tool surface is identical however an agent
// connects. Client code that only needs the metadata imports the manifest.

import type { SupabaseClient } from '@supabase/supabase-js'
import { AGENT_TOOL_MANIFEST, type AgentToolMeta } from './agent-tools-manifest'
import { DEFAULT_CHART } from './chart'
import { loadPostedLedger, loadEntityNames, loadOwnership } from './load'
import { accountIdByCode, persistEntry } from './persist'
import { computeCapitalAccounts, totalNav } from './capital-account'
import { trialBalance, balanceSheet, incomeStatement } from './statements'
import { reconcileCapital, type AdminCapitalAccount } from './reconcile'
import { runWaterfall } from './waterfall'
import { buildAllocationEntry, type AllocationBody } from './allocation-actions'
import { importBankTransactions } from './bank-import'
import { runCategorization } from './categorize-run'
import { bookCapitalCallFromInflow } from './bank-match'
import { exportLedgerText, postLedgerText } from './text-ledger-run'
import { summarizeBankRec, type BankTxnState } from './bank'
import { accountBalances } from './ledger'
import { listVehicles } from './load'
import type { SupabaseClient as _Sb } from '@supabase/supabase-js'
import type { JournalEntry, Posting } from './types'

export interface AgentToolContext {
  admin: SupabaseClient
  fundId: string
  /** The vehicle (portfolio_group) this call operates on. */
  portfolioGroup: string
  userId: string | null
}

export type AgentToolHandler = (ctx: AgentToolContext, input: any) => Promise<any>
export interface AgentTool extends AgentToolMeta {
  handler: AgentToolHandler
}

const HANDLERS: Record<string, AgentToolHandler> = {
  list_accounts: async ({ admin, fundId, portfolioGroup }) => {
    const { accounts } = await loadPostedLedger(admin, fundId, portfolioGroup)
    return accounts.map(a => ({ code: a.code, name: a.name, type: a.type, subtype: a.subtype ?? null }))
  },

  seed_chart: async ({ admin, fundId, portfolioGroup }) => {
    const { count } = await admin.from('chart_of_accounts' as any).select('id', { count: 'exact', head: true }).eq('fund_id', fundId).eq('portfolio_group', portfolioGroup)
    if ((count ?? 0) > 0) return { seeded: 0, message: 'Chart already exists' }
    const rows = DEFAULT_CHART.map(a => ({ fund_id: fundId, portfolio_group: portfolioGroup, code: a.code, name: a.name, type: a.type, subtype: a.subtype ?? null }))
    const { data, error } = await admin.from('chart_of_accounts' as any).insert(rows).select('code')
    if (error) throw new Error(error.message)
    return { seeded: (data as any[])?.length ?? 0 }
  },

  list_entities: async ({ admin, fundId, portfolioGroup }) => {
    const [names, ownership] = await Promise.all([loadEntityNames(admin, fundId, portfolioGroup), loadOwnership(admin, fundId, portfolioGroup)])
    const commitment = new Map(ownership.map(o => [o.lpEntityId, o.commitment]))
    return Array.from(names.entries()).map(([lpEntityId, name]) => ({ lpEntityId, name, commitment: commitment.get(lpEntityId) ?? 0 }))
  },

  capital_accounts: async ({ admin, fundId, portfolioGroup }) => {
    const [{ capitalPostings }, names] = await Promise.all([loadPostedLedger(admin, fundId, portfolioGroup), loadEntityNames(admin, fundId, portfolioGroup)])
    const accounts = computeCapitalAccounts(capitalPostings)
    const rows = Array.from(accounts.entries()).map(([lpEntityId, account]) => ({ lpEntityId, name: names.get(lpEntityId) ?? lpEntityId, ...account }))
    return { rows, nav: totalNav(accounts) }
  },

  financial_statements: async ({ admin, fundId, portfolioGroup }) => {
    const { accounts, postings } = await loadPostedLedger(admin, fundId, portfolioGroup)
    return {
      trialBalance: trialBalance(accounts, postings),
      balanceSheet: balanceSheet(accounts, postings),
      incomeStatement: incomeStatement(accounts, postings),
    }
  },

  list_journal: async ({ admin, fundId, portfolioGroup }, input) => {
    const limit = Math.min(Number(input?.limit ?? 100), 500)
    const { data } = await admin.from('journal_entries' as any).select('*, journal_postings(*)').eq('fund_id', fundId).eq('portfolio_group', portfolioGroup).order('entry_date', { ascending: false }).limit(limit)
    return data ?? []
  },

  post_entry: async ({ admin, fundId, portfolioGroup, userId }, input) => {
    const codes = await accountIdByCode(admin, fundId, portfolioGroup)
    const postings: Posting[] = (input.postings ?? []).map((p: any) => {
      const accountId = p.accountId ?? codes.get(p.accountCode)
      if (!accountId) throw new Error(`Unknown account code ${p.accountCode}`)
      return { accountId, amount: Number(p.amount), currency: p.currency ?? 'USD', lpEntityId: p.lpEntityId ?? null }
    })
    const entry: JournalEntry = { fundId, entryDate: input.entryDate, memo: input.memo ?? null, sourceType: input.sourceType ?? 'manual', postings }
    const result = await persistEntry(admin, fundId, portfolioGroup, userId, entry, input.status === 'draft' ? 'draft' : 'posted')
    if ('error' in result) throw new Error(result.error)
    return { entryId: result.entryId }
  },

  allocation: async ({ admin, fundId, portfolioGroup, userId }, input) => {
    const built = await buildAllocationEntry(admin, fundId, portfolioGroup, input as AllocationBody)
    if ('error' in built) throw new Error(built.error)
    if (input.post === false) return { preview: built.entry }
    const result = await persistEntry(admin, fundId, portfolioGroup, userId, built.entry, 'posted')
    if ('error' in result) throw new Error(result.error)
    return { entryId: result.entryId, entry: built.entry }
  },

  reconcile: async ({ admin, fundId, portfolioGroup }, input) => {
    const { capitalPostings } = await loadPostedLedger(admin, fundId, portfolioGroup)
    const ledger = computeCapitalAccounts(capitalPostings)
    const adminMap = new Map<string, AdminCapitalAccount>(Object.entries(input?.admin ?? {}))
    return reconcileCapital(ledger, adminMap, typeof input?.tolerance === 'number' ? input.tolerance : 0.01)
  },

  run_waterfall: async (_ctx, input) => runWaterfall(Number(input.distributable), input.terms, input.state),

  export_ledger_text: async ({ admin, fundId, portfolioGroup }) => ({ text: await exportLedgerText(admin, fundId, portfolioGroup) }),

  post_ledger_text: async ({ admin, fundId, portfolioGroup, userId }, input) => {
    return postLedgerText(admin, fundId, portfolioGroup, userId, String(input.text ?? ''), input.status)
  },

  import_bank_transactions: async ({ admin, fundId, portfolioGroup, userId }, input) => {
    const result = await importBankTransactions(admin, fundId, portfolioGroup, userId, String(input.csv ?? ''), String(input.source ?? 'csv'))
    if ('error' in result) throw new Error(result.error)
    return result
  },

  categorize_bank_transactions: async ({ admin, fundId, portfolioGroup }, input) => {
    const result = await runCategorization(admin, fundId, portfolioGroup, Array.isArray(input?.ids) ? input.ids : undefined)
    if ('error' in result) throw new Error(result.error)
    return result
  },

  book_capital_call: async ({ admin, fundId, portfolioGroup, userId }, input) => {
    const result = await bookCapitalCallFromInflow(admin, fundId, portfolioGroup, userId, String(input.bankTransactionId))
    if ('error' in result) throw new Error(result.error)
    return result
  },

  list_bank_transactions: async ({ admin, fundId, portfolioGroup }) => {
    const { data } = await admin
      .from('bank_transactions' as any)
      .select('id, txn_date, amount, description, counterparty, status, suggested_account_code, journal_entry_id')
      .eq('fund_id', fundId)
      .eq('portfolio_group', portfolioGroup)
      .order('txn_date', { ascending: false })
      .limit(1000)
    return data ?? []
  },

  bank_reconciliation: async ({ admin, fundId, portfolioGroup }) => {
    const { accounts, postings } = await loadPostedLedger(admin, fundId, portfolioGroup)
    const cash = accounts.find(a => a.code === '1000')
    const ledgerCashBalance = cash ? (accountBalances(postings).get(cash.id) ?? 0) : 0
    const { data } = await admin.from('bank_transactions' as any).select('amount, status').eq('fund_id', fundId).eq('portfolio_group', portfolioGroup).neq('status', 'ignored')
    const txns: BankTxnState[] = ((data as any[]) ?? []).map(t => ({ amount: Number(t.amount), matched: t.status === 'reconciled' }))
    return summarizeBankRec(txns, ledgerCashBalance)
  },
}

const VEHICLE_PROP = { type: 'string', description: 'vehicle (portfolio_group); optional when the fund has a single vehicle' }

export const AGENT_TOOLS: AgentTool[] = AGENT_TOOL_MANIFEST.map(meta => {
  const handler = HANDLERS[meta.name]
  if (!handler) throw new Error(`No handler for agent tool ${meta.name}`)
  // Every tool operates on one vehicle — advertise the `vehicle` argument.
  const inputSchema = { ...meta.inputSchema, properties: { ...(meta.inputSchema.properties ?? {}), vehicle: VEHICLE_PROP } }
  return { ...meta, inputSchema, handler }
})

export function getTool(name: string): AgentTool | undefined {
  return AGENT_TOOLS.find(t => t.name === name)
}

/**
 * Resolve the vehicle (portfolio_group) an agent call targets: the explicit
 * `vehicle` argument, or the sole vehicle if the fund has exactly one. Throws
 * (with the list) when it's ambiguous.
 */
export async function resolveVehicle(admin: _Sb, fundId: string, requested?: string): Promise<string> {
  if (requested) return requested
  const vehicles = await listVehicles(admin, fundId)
  if (vehicles.length === 1) return vehicles[0]
  if (vehicles.length === 0) throw new Error('No vehicles found for this fund')
  throw new Error(`Specify a vehicle — this fund has several: ${vehicles.join(', ')}`)
}
