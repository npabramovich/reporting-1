// From plain-text books back to the engine's inputs: a chart, postings and capital postings.
//
// The text ledger names every account `Root:Slug:Code` (text-ledger.ts). The root gives the
// account type, the last component is the chart code, and a partner's capital account is the
// equity account whose code is `3100-<entity>` — the app's per-partner capital code. That is
// everything the roll-forward needs: which postings touched a partner's capital, when, and under
// which source type.

import type { Account, AccountType, Posting } from './types.ts'
import type { CapitalPosting } from './capital-account.ts'
import { codeFromAccountName, type ParsedTextEntry } from './text-ledger.ts'

const TYPE_BY_ROOT: Record<string, AccountType> = {
  Assets: 'asset',
  Liabilities: 'liability',
  Equity: 'equity',
  Income: 'income',
  Expenses: 'expense',
}

/** The app's per-partner capital code: `3100-` followed by the first 8 characters of the entity id. */
export const DEFAULT_CAPITAL_ACCOUNT_PATTERN = /^3100-.+$/

export interface PartnerMapping {
  /** The partner id the output uses (and carry recipients refer to). */
  id: string
  /** The chart code of the partner's capital account, e.g. `3100-aaaaaaaa`. */
  account?: string
}

export interface TextBooks {
  /** One account per distinct account name. `id` is the full text name; `code` its last component. */
  accounts: Account[]
  /** Every posting on an included entry, dated. */
  postings: Posting[]
  /** Postings to partner capital accounts, with the entry's source type. */
  capitalPostings: CapitalPosting[]
  /** Partner id per capital account code, for every capital account seen. */
  partnerByAccount: Map<string, string>
  /** The display name the text carries for each account (slug with dashes as spaces). */
  accountNames: Map<string, string>
  /** Currencies seen on included postings. */
  currencies: string[]
  /** Entries included / skipped (drafts, or after the as-of date). */
  included: number
  skippedDrafts: number
  skippedAfterAsOf: number
  /** Account names whose root is not one of the five account types. */
  unknownRoots: string[]
}

export interface BooksOptions {
  /** Include only entries on or before this date (YYYY-MM-DD). */
  asOf?: string | null
  /** Include draft (`!`) entries. The app's statements use posted (`*`) entries only. */
  includeDrafts?: boolean
  /** Which chart codes are partner capital accounts. */
  capitalAccountPattern?: RegExp
  /** Explicit partner ↔ capital-account mapping. Unmapped capital accounts use their code as the id. */
  partners?: PartnerMapping[]
}

function displayName(textName: string): string {
  const parts = textName.split(':')
  return parts.length >= 3 ? parts.slice(1, -1).join(':').replace(/-/g, ' ') : parts[parts.length - 1]
}

/** Assemble the engine's inputs from parsed text entries. */
export function booksFromText(entries: ParsedTextEntry[], opts: BooksOptions = {}): TextBooks {
  const pattern = opts.capitalAccountPattern ?? DEFAULT_CAPITAL_ACCOUNT_PATTERN
  const mapped = new Map<string, string>()
  for (const p of opts.partners ?? []) if (p.account) mapped.set(p.account, p.id)

  const accounts = new Map<string, Account>()
  const accountNames = new Map<string, string>()
  const partnerByAccount = new Map<string, string>()
  const unknownRoots = new Set<string>()
  const currencies = new Set<string>()
  const postings: Posting[] = []
  const capitalPostings: CapitalPosting[] = []
  let included = 0
  let skippedDrafts = 0
  let skippedAfterAsOf = 0

  const accountFor = (name: string): Account => {
    const existing = accounts.get(name)
    if (existing) return existing
    const root = name.split(':')[0]
    const type = TYPE_BY_ROOT[root]
    if (!type) unknownRoots.add(name)
    const code = codeFromAccountName(name)
    const resolvedType: AccountType = type ?? 'asset'
    const isCapital = resolvedType === 'equity' && (pattern.test(code) || mapped.has(code))
    const lpEntityId = isCapital ? mapped.get(code) ?? code : null
    const account: Account = { id: name, fundId: '', code, name: displayName(name), type: resolvedType, lpEntityId }
    accounts.set(name, account)
    accountNames.set(code, account.name)
    if (lpEntityId) partnerByAccount.set(code, lpEntityId)
    return account
  }

  for (const [index, e] of entries.entries()) {
    if (e.flag !== '*' && !opts.includeDrafts) { skippedDrafts++; continue }
    if (opts.asOf && e.date > opts.asOf) { skippedAfterAsOf++; continue }
    included++
    const entryId = `${e.date}#${index + 1}`
    for (const p of e.postings) {
      const account = accountFor(p.account)
      const amount = p.amount ?? 0
      currencies.add(p.currency)
      postings.push({ accountId: account.id, amount, currency: p.currency, lpEntityId: account.lpEntityId ?? null, entryDate: e.date })
      if (account.lpEntityId) {
        capitalPostings.push({
          entryId,
          currency: p.currency,
          lpEntityId: account.lpEntityId,
          amount,
          sourceType: e.sourceType ?? null,
          entryDate: e.date,
        })
      }
    }
  }

  return {
    accounts: Array.from(accounts.values()),
    postings,
    capitalPostings,
    partnerByAccount,
    accountNames,
    currencies: Array.from(currencies).sort(),
    included,
    skippedDrafts,
    skippedAfterAsOf,
    unknownRoots: Array.from(unknownRoots),
  }
}
