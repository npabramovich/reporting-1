import type { QbAccountSummary } from './parse-journal'

/**
 * Propose a mapping from QuickBooks' chart to ours. Pure and deterministic.
 *
 * Every proposal is confirmed by a human before anything imports, so this optimizes for
 * being USEFUL AND HONEST rather than always right: a confident wrong mapping silently
 * misstates a whole account for years of history, while `confidence: 'none'` costs one
 * dropdown. When in doubt, return none.
 *
 * The one genuinely clever step is holding discovery. A fund of funds keeps a QuickBooks
 * sub-account per underlying fund ("Investments:Acme Ventures III"), so the mapping screen
 * is also where the twenty-odd fund holdings get created — the leaf of an investment
 * account path is the fund's name.
 */

export interface ChartAccount {
  id: string
  code: string
  name: string
  type: string
  subtype: string | null
  company_id?: string | null
  lp_entity_id?: string | null
  is_active?: boolean
}

export interface MappingProposal {
  qbAccount: string
  code: string | null
  confidence: 'exact' | 'likely' | 'none'
  reason: string
  /** Non-null when this QB account implies a fund holding we should create. */
  suggestsHolding: string | null
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')
const leaf = (path: string) => path.split(':').pop()!.trim()
const head = (path: string) => path.split(':')[0]!.trim()

// Keyword → account subtype. Ordered: the first hit wins, so put the specific before the general.
//
// A rule whose subtype is absent from THIS vehicle's chart is skipped, not failed — so several
// rules can chain for the same wording and each chart takes the one it can use. That is how
// "Management Fee" reaches the EXPENSE on a fund's chart and the INCOME on a management company's,
// from the same QuickBooks account name, with no chart-kind switch anywhere in this file.
export const PARTNER_CAPITAL = /\b(partners?[’']?s?|members?[’']?s?)\s+(investments?|contributions?|capital|equity)\b/i

const KEYWORDS: { match: RegExp; subtype: string; why: string }[] = [
  // "operating" alone used to be a cash keyword, which made "Operating Expenses" — the largest
  // account on many management companies' and GP entities' books — map confidently to the bank
  // account. It now has to look like an account, not an expense line.
  { match: /\b(bank|checking|cash|money market)\b|\boperating\s+(account|bank|cash)\b/i, subtype: 'cash', why: 'looks like a bank or cash account' },
  { match: PARTNER_CAPITAL, subtype: 'lp_capital', why: 'names capital invested by partners' },
  { match: PARTNER_CAPITAL, subtype: 'members_capital', why: 'names capital invested by members' },
  { match: /\bmanagement fee\b/i, subtype: 'management_fee', why: 'names the management fee' },
  // The manco side of the same words: a fund PAYS the management fee, the management company EARNS
  // it, and QuickBooks calls both "Management Fee". Reached only when the chart has no management
  // fee EXPENSE, which is exactly the management company's case.
  { match: /\bmanagement fee\b/i, subtype: 'management_fee_income', why: 'names the management fee, and this entity earns it' },
  // ---- Management company: compensation. Most of a manco's ledger, and none of it has any
  // analogue on a fund's chart — so these rules are inert on a fund (no such subtype) and do the
  // bulk of the work on a manco.
  { match: /\b(payroll|employment|fica|futa|suta)\s*(tax|taxes)\b|\bemployer\s+tax/i, subtype: 'payroll_taxes', why: 'looks like employer payroll taxes' },
  { match: /\b(bonus|incentive|commission)s?\b/i, subtype: 'incentive_compensation', why: 'looks like incentive compensation' },
  { match: /\b(benefit|health|medical|dental|401\s?k|retirement|insurance premium)s?\b/i, subtype: 'benefits', why: 'looks like employee benefits' },
  { match: /\b(salar(y|ies)|wages|payroll|compensation|guaranteed payment)s?\b/i, subtype: 'salaries', why: 'looks like salaries and wages' },
  // ---- Management company: the rest of an operating business.
  { match: /\b(rent|lease|occupancy|utilit(y|ies))\b/i, subtype: 'occupancy', why: 'looks like rent or occupancy' },
  { match: /\b(software|subscription|technology|it|saas|hosting|computer)s?\b/i, subtype: 'technology', why: 'looks like technology and software' },
  { match: /\b(travel|meals|entertainment|conference)s?\b/i, subtype: 'travel', why: 'looks like travel and entertainment' },
  { match: /\b(marketing|business development|advertis(ing|ement))\b/i, subtype: 'marketing', why: 'looks like marketing' },
  { match: /\bdeprec|amorti[sz]/i, subtype: 'depreciation', why: 'looks like depreciation or amortization' },
  { match: /\b(due (to|from)|intercompany|inter-company|affiliate)\b/i, subtype: 'intercompany_receivable', why: 'looks like an intercompany balance' },
  { match: /\bdeferred\s+(revenue|income|fee)/i, subtype: 'deferred_revenue', why: 'looks like fee income billed in advance' },
  // ---- Shared.
  { match: /\b(audit|legal|accounting|professional|admin|partnership)\s+(fee|expense)s?\b/i, subtype: 'partnership_expense', why: 'looks like a partnership expense' },
  { match: /\b(audit|tax|accounting)\s+(fee|expense)s?\b/i, subtype: 'professional_fees', why: 'looks like audit or tax fees' },
  { match: /\blegal\b/i, subtype: 'legal', why: 'looks like legal fees' },
  { match: /\borgani[sz]ation(al)?\s+(cost|expense)s?\b/i, subtype: 'organizational_expense', why: 'looks like an organizational expense' },
  { match: /\binterest\s+(income|earned)\b/i, subtype: 'interest_income', why: 'looks like interest income' },
  { match: /\brealized\s+(gains?|loss(?:es)?)\b/i, subtype: 'realized_gain', why: 'looks like realized gain/loss' },
  { match: /\bunrealized\b/i, subtype: 'unrealized', why: 'looks like an unrealized valuation account' },
  { match: /\b(accrued|accounts payable|a\/p)\b/i, subtype: 'accrued', why: 'looks like an accrual or payable' },
  { match: /\b(partners?'? capital|members?'? capital|equity)\b/i, subtype: 'lp_capital', why: "looks like partners' capital" },
  // A manco's equity is members' capital, and its chart has no lp_capital to catch the line above.
  { match: /\b(members?'? capital|equity|capital account)\b/i, subtype: 'members_capital', why: "looks like members' capital" },
  { match: /\b(draw|distribution)s?\b/i, subtype: 'member_distributions', why: 'looks like a distribution to the members' },
  // Investment assets are a fallback only when the wording is not capital or income.
  { match: /^(?!.*\b(?:partners?|members?|capital|equity|income|gains?|loss(?:es)?|unrealized|realized)\b).*\b(?:investments?|portfolio|holdings?)\b/i, subtype: 'investment', why: 'looks like an investment asset account' },
  // Last resort for an expense on a chart that has a catch-all operating line (GP entities do).
  { match: /\bexpenses?\b/i, subtype: 'operating_expense', why: 'looks like an operating expense' },
]

export function proposeMapping(
  qbAccounts: QbAccountSummary[],
  chart: ChartAccount[],
): MappingProposal[] {
  chart = chart.filter(a => a.is_active !== false)
  const byName = new Map(chart.map(a => [norm(a.name), a]))
  const bySubtype = new Map<string, ChartAccount>()
  for (const a of chart) if (a.subtype && !a.company_id && !a.lp_entity_id && !a.code.includes('-') && !bySubtype.has(a.subtype)) bySubtype.set(a.subtype, a)

  return qbAccounts.map(({ account }) => {
    const holding = holdingFor(account)

    // A holding must retain its own ledger identity, never fall back to pooled cost.
    if (holding) {
      const target = chart.find(a => a.company_id && a.subtype === 'investment' &&
        [holding, `Investment — ${holding}`, `Investments at cost — ${holding}`, account].some(n => norm(n) === norm(a.name)))
      return { qbAccount: account, code: target?.code ?? null,
        confidence: target ? 'exact' as const : 'none' as const,
        reason: target ? `Dedicated investment account for ${holding}.` : `Create or link ${holding} below to keep its investment balance separate.`,
        suggestsHolding: holding }
    }

    // Accumulated amortization is a contra-asset, not amortization expense.
    if (/accumulated.*(amorti[sz]|deprec)/i.test(account)) {
      const target = chart.find(a => a.type === 'asset' && norm(a.name) === norm(account))
      return { qbAccount: account, code: target?.code ?? null, confidence: target ? 'exact' as const : 'none' as const,
        reason: 'Accumulated amortization/depreciation needs a separate contra-asset account.', suggestsHolding: null }
    }

    // 1. Our account name, verbatim.
    const exact = byName.get(norm(leaf(account))) ?? byName.get(norm(account))
    if (exact) {
      return { qbAccount: account, code: exact.code, confidence: 'exact' as const,
               reason: `Matches "${exact.name}" by name.`, suggestsHolding: holding }
    }

    // 2. Keyword → subtype → the first account of that subtype in our chart.
    for (const k of KEYWORDS) {
      if (!k.match.test(account)) continue
      const target = bySubtype.get(k.subtype)
      if (!target) continue
      return { qbAccount: account, code: target.code, confidence: 'likely' as const,
               reason: `${cap(k.why)}; mapped to ${target.code} ${target.name}.`, suggestsHolding: holding }
    }

    return {
      qbAccount: account, code: null, confidence: 'none' as const,
      reason: 'No confident match in the chart of accounts — choose one, or add an account for it.',
      suggestsHolding: holding,
    }
  })
}

/**
 * The fund holding a QuickBooks account implies, if any. Only a SUB-account under an
 * investments parent counts: "Investments:Acme Ventures III" is a holding, bare "Investments"
 * is the parent, and a top-level "Acme Ventures III" is too ambiguous to act on — guessing
 * there would create a phantom holding carrying a real commitment field.
 */
function holdingFor(account: string): string | null {
  if (!account.includes(':')) return null
  if (!/^invest(ment)?s?\b|^portfolio\b|^holdings?\b/i.test(head(account))) return null
  const name = leaf(account)
  return name && !/^invest(ment)?s?$/i.test(name) ? name : null
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
