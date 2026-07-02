// AI entry-drafting: turn a source document (capital-call notice, invoice, wire
// confirmation, distribution notice) into a proposed balanced journal entry that
// a human reviews before posting. The prompt is pure so it's testable; the model
// call lives in the route. The model proposes; assertBalanced and human review
// are the guardrails.

import { entryImbalance } from './ledger'
import type { Account, JournalEntry, Posting } from './types'

export const DRAFT_SOURCE_TYPES = [
  'capital_call',
  'distribution',
  'management_fee',
  'partnership_expense',
  'organizational_expense',
  'realized_gain',
  'income',
  'valuation',
  'opening_balance',
  'manual',
]

export function buildDraftPrompt(accounts: Account[], documentText: string): { system: string; content: string } {
  const chart = accounts.map(a => `${a.code}  ${a.name}  (${a.type})`).join('\n')
  const system = [
    'You are a meticulous fund accountant. Convert the source document into ONE balanced',
    'double-entry journal entry for the fund.',
    '',
    'Rules:',
    '- Use ONLY these accounts, referenced by code:',
    chart,
    '- `amount` is signed: debits are POSITIVE, credits are NEGATIVE.',
    '- The postings MUST sum to exactly 0.',
    `- Choose one sourceType from: ${DRAFT_SOURCE_TYPES.join(', ')}.`,
    '- If the document names a specific LP entity, put its name in the posting `lpEntity` field; otherwise omit it.',
    '- Respond with STRICT JSON only — no prose, no code fences:',
    '{"entryDate":"YYYY-MM-DD","memo":"...","sourceType":"...","postings":[{"accountCode":"1000","amount":100000,"currency":"USD","lpEntity":null}]}',
  ].join('\n')
  return { system, content: documentText }
}

export interface DraftedPosting {
  accountCode: string
  amount: number
  currency?: string
  lpEntity?: string | null
}
export interface DraftedEntry {
  entryDate: string
  memo?: string
  sourceType?: string
  postings: DraftedPosting[]
}

/** Extract the JSON object from a model response, tolerating code fences / prose. */
export function parseDraftedEntry(text: string): DraftedEntry {
  let s = text.trim()
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) s = fence[1].trim()
  const start = s.indexOf('{')
  const end = s.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) throw new Error('No JSON object found in model response')
  const obj = JSON.parse(s.slice(start, end + 1))

  if (!obj || !Array.isArray(obj.postings) || obj.postings.length === 0) {
    throw new Error('Drafted entry has no postings')
  }
  const postings: DraftedPosting[] = obj.postings.map((p: any) => ({
    accountCode: String(p.accountCode ?? p.code ?? ''),
    amount: Number(p.amount),
    currency: p.currency ?? 'USD',
    lpEntity: p.lpEntity ?? null,
  }))
  if (postings.some(p => !p.accountCode || !Number.isFinite(p.amount))) {
    throw new Error('Each posting needs an accountCode and a numeric amount')
  }
  return {
    entryDate: String(obj.entryDate ?? ''),
    memo: obj.memo ?? null,
    sourceType: obj.sourceType ?? 'manual',
    postings,
  }
}

/**
 * Resolve a drafted entry against the chart (code → account) and LP names, into a
 * JournalEntry plus a diagnostic imbalance. Unknown account codes are reported,
 * not silently dropped.
 */
export function resolveDraftedEntry(
  drafted: DraftedEntry,
  fundId: string,
  accountsByCode: Map<string, string>,
  entityByName: Map<string, string>
): { entry: JournalEntry; imbalance: Record<string, number>; unknownCodes: string[] } {
  const unknownCodes: string[] = []
  const postings: Posting[] = drafted.postings.map(p => {
    const accountId = accountsByCode.get(p.accountCode)
    if (!accountId) unknownCodes.push(p.accountCode)
    const lpEntityId = p.lpEntity ? entityByName.get(p.lpEntity.toLowerCase()) ?? null : null
    return { accountId: accountId ?? p.accountCode, amount: p.amount, currency: p.currency ?? 'USD', lpEntityId }
  })
  const entry: JournalEntry = {
    fundId,
    entryDate: drafted.entryDate,
    memo: drafted.memo ?? null,
    sourceType: drafted.sourceType ?? 'manual',
    status: 'draft',
    postings,
  }
  return { entry, imbalance: entryImbalance(entry), unknownCodes }
}
