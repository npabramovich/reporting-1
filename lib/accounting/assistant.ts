// Inline accounting assistant. Gathers the vehicle's books (chart, balances,
// recent entries) as context, asks the fund's AI to review the work and/or draft
// the entry the user describes, and returns structured findings + proposals.
// Nothing is posted automatically: a proposal is applied as a DRAFT entry the
// user reviews and posts. Proposals reference standard chart codes (per-LP
// capital calls stay in the Bank "Book as call" flow, not here).

import type { SupabaseClient } from '@supabase/supabase-js'
import { createFundAIProviderWithOverride } from '@/lib/ai'
import { loadPostedLedger } from './load'
import { accountBalances } from './ledger'
import { accountIdByCode, persistEntry } from './persist'
import { vehicleIdByName } from './vehicle-id'
import type { JournalEntry, Posting } from './types'

export interface AssistantProposalPosting { accountCode: string; amount: number }
export interface AssistantProposal {
  type: 'create' | 'edit'
  entryId?: string | null
  entryDate: string
  memo: string
  sourceType?: string | null
  postings: AssistantProposalPosting[]
  rationale: string
}
export interface AssistantFinding {
  severity: 'info' | 'warning' | 'error'
  title: string
  detail: string
  entryId?: string | null
}
export interface AssistantResult {
  summary: string
  findings: AssistantFinding[]
  proposals: AssistantProposal[]
}

/** A compact, readable snapshot of the vehicle's books for the model. */
async function gatherContext(admin: SupabaseClient, fundId: string, group: string): Promise<string> {
  const vehicleId = await vehicleIdByName(admin, fundId, group)

  const [{ data: acctRows }, { accounts, postings }, { data: entryRows }] = await Promise.all([
    admin.from('chart_of_accounts' as any).select('id, code, name, type, subtype').eq('fund_id', fundId).eq('vehicle_id', vehicleId).order('code'),
    loadPostedLedger(admin, fundId, group),
    admin.from('journal_entries' as any)
      .select('id, entry_date, memo, source_type, status, journal_postings(account_id, amount)')
      .eq('fund_id', fundId).eq('vehicle_id', vehicleId).neq('status', 'void')
      .order('entry_date', { ascending: false }).limit(40),
  ])

  const codeById = new Map<string, string>(((acctRows as any[]) ?? []).map(a => [a.id, `${a.code} ${a.name}`]))
  const chartLines = ((acctRows as any[]) ?? []).map(a => `  ${a.code}  ${a.name} (${a.type}${a.subtype ? '/' + a.subtype : ''})`).join('\n')

  const bal = accountBalances(postings)
  const balLines = accounts
    .map(a => ({ a, b: bal.get(a.id) ?? 0 }))
    .filter(x => Math.abs(x.b) > 0.005)
    .map(x => `  ${x.a.code} ${x.a.name}: ${x.b.toFixed(2)}`)
    .join('\n')

  const entryLines = ((entryRows as any[]) ?? []).map(e => {
    const posts = ((e.journal_postings ?? []) as any[])
      .map(p => `${codeById.get(p.account_id) ?? p.account_id.slice(0, 8)} ${Number(p.amount).toFixed(2)}`)
      .join('; ')
    return `  [${e.id}] ${e.entry_date} "${e.memo ?? e.source_type ?? ''}" (${e.status}): ${posts}`
  }).join('\n')

  return [
    `CHART OF ACCOUNTS:\n${chartLines || '  (none)'}`,
    `\nPOSTED ACCOUNT BALANCES (debit positive):\n${balLines || '  (all zero)'}`,
    `\nRECENT JOURNAL ENTRIES (id, date, memo, status, postings as "code amount"; debit +, credit -):\n${entryLines || '  (none)'}`,
  ].join('\n')
}

const SYSTEM = `You are an expert fund-accounting assistant working inside a double-entry ledger for one vehicle.
Sign convention: every posting amount is the signed change to the account — DEBIT positive, CREDIT negative — and each entry's postings MUST sum to exactly 0.
Only use account codes that already exist in the provided chart. Do not invent codes.
Do NOT propose per-LP capital-call allocations (those are handled elsewhere); work at the standard chart level (e.g. 3100 for LP capital, 3000 for GP capital).
When reviewing, look for: entries that don't balance, obviously mis-categorized postings, missing counterparts (e.g. a loan drawn but never repaid), and unusual amounts.
Respond with STRICT JSON ONLY (no prose, no code fences) of this exact shape:
{
  "summary": "one short paragraph",
  "findings": [{"severity":"info|warning|error","title":"...","detail":"...","entryId":"<id or null>"}],
  "proposals": [{"type":"create|edit","entryId":"<id for edit, else null>","entryDate":"YYYY-MM-DD","memo":"...","sourceType":"manual","postings":[{"accountCode":"1100","amount":5000000},{"accountCode":"2200","amount":-5000000}],"rationale":"why"}]
}
Return findings and proposals only when warranted; empty arrays are fine.`

export async function runAssistant(
  admin: SupabaseClient,
  fundId: string,
  group: string,
  message: string
): Promise<AssistantResult | { error: string }> {
  const context = await gatherContext(admin, fundId, group)

  let provider
  try {
    provider = await createFundAIProviderWithOverride(admin, fundId)
  } catch (e) {
    return { error: `AI provider not configured: ${(e as Error).message}` }
  }

  const content = `${context}\n\n---\nUSER REQUEST: ${message || 'Review these books and flag anything that looks wrong.'}`
  let text: string
  try {
    const result = await provider.provider.createMessage({ model: provider.model, maxTokens: 3000, system: SYSTEM, content })
    text = result.text
  } catch (e) {
    return { error: `AI request failed: ${(e as Error).message}` }
  }

  const parsed = parseAssistant(text)
  if (!parsed) return { error: 'The assistant returned an unreadable response — try again or rephrase.' }
  return parsed
}

function parseAssistant(text: string): AssistantResult | null {
  const cleaned = text.replace(/```json\s*|\s*```/g, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end < 0) return null
  try {
    const obj = JSON.parse(cleaned.slice(start, end + 1))
    return {
      summary: typeof obj.summary === 'string' ? obj.summary : '',
      findings: Array.isArray(obj.findings) ? obj.findings : [],
      proposals: Array.isArray(obj.proposals) ? obj.proposals : [],
    }
  } catch {
    return null
  }
}

/** Apply one proposal as a DRAFT entry (create, or edit an existing entry). */
export async function applyProposal(
  admin: SupabaseClient,
  fundId: string,
  group: string,
  userId: string | null,
  proposal: AssistantProposal
): Promise<{ entryId: string } | { error: string }> {
  const codes = await accountIdByCode(admin, fundId, group)
  const postings: Posting[] = []
  for (const p of proposal.postings ?? []) {
    const accountId = codes.get(String(p.accountCode))
    if (!accountId) return { error: `Unknown account code ${p.accountCode}` }
    postings.push({ accountId, amount: Number(p.amount), currency: 'USD', lpEntityId: null })
  }
  if (postings.length === 0) return { error: 'The proposal has no postings' }

  if (proposal.type === 'edit' && proposal.entryId) {
    const vehicleId = await vehicleIdByName(admin, fundId, group)
    const { data: existing } = await admin.from('journal_entries' as any)
      .select('id, status').eq('id', proposal.entryId).eq('fund_id', fundId).eq('vehicle_id', vehicleId).maybeSingle()
    if (!existing) return { error: 'Entry to edit not found' }

    // Bring a posted entry back to draft first (and any bank txn that points at it).
    if ((existing as any).status !== 'draft') {
      await admin.from('journal_entries' as any).update({ status: 'draft', posted_at: null }).eq('id', proposal.entryId).eq('fund_id', fundId)
      await admin.from('bank_transactions' as any).update({ status: 'drafted' }).eq('journal_entry_id', proposal.entryId).eq('fund_id', fundId)
    }

    const { data: oldRows } = await admin.from('journal_postings' as any).select('id').eq('journal_entry_id', proposal.entryId)
    const { error: insErr } = await admin.from('journal_postings' as any).insert(
      postings.map(p => ({ fund_id: fundId, portfolio_group: group, vehicle_id: vehicleId, journal_entry_id: proposal.entryId, account_id: p.accountId, amount: p.amount, currency: p.currency, lp_entity_id: null }))
    )
    if (insErr) return { error: insErr.message }
    const oldIds = ((oldRows as any[]) ?? []).map(r => r.id)
    if (oldIds.length) await admin.from('journal_postings' as any).delete().in('id', oldIds)
    await admin.from('journal_entries' as any).update({ entry_date: proposal.entryDate, memo: proposal.memo ?? null }).eq('id', proposal.entryId).eq('fund_id', fundId)
    return { entryId: proposal.entryId }
  }

  const entry: JournalEntry = {
    fundId,
    entryDate: proposal.entryDate,
    memo: proposal.memo ?? null,
    sourceType: proposal.sourceType ?? 'manual',
    postings,
  }
  const result = await persistEntry(admin, fundId, group, userId, entry, 'draft')
  if ('error' in result) return { error: result.error }
  return { entryId: result.entryId }
}
