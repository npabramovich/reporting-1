import { PARTNER_CAPITAL } from './propose-mapping'
import type { AccountType } from '../types'

export interface AccountSuggestion {
  code: string
  name: string
  type: AccountType
  subtype: string | null
}

/** Suggestions are editable: a Journal contains names, not authoritative account types. */
export function suggestAccount(name: string, chart: { code: string }[]): AccountSuggestion {
  let type: AccountType = 'expense'
  let base = 5900
  let subtype: string | null = null
  if (PARTNER_CAPITAL.test(name)) {
    type = 'equity'; base = 3100; subtype = 'lp_capital'
  } else if (/\brealized\s+gains?\b/i.test(name)) {
    type = 'income'; base = 4000; subtype = 'realized_gain'
  } else if (/accumulated.*(amorti[sz]|deprec)/i.test(name)) {
    type = 'asset'; base = 1700; subtype = 'accumulated_amortization'
  } else if (/amorti[sz]|depreciation/i.test(name)) {
    base = 5800; subtype = 'depreciation'
  } else if (/software|apps|subscription|technology/i.test(name)) {
    base = 5300; subtype = 'technology'
  } else if (/payable|liabilit|accrued|due to|loan/i.test(name)) {
    type = 'liability'; base = 2900
  } else if (/capital|equity|retained earnings/i.test(name)) {
    type = 'equity'; base = 3900
  } else if (/income|revenue|gain/i.test(name)) {
    type = 'income'; base = 4900
  } else if (/asset|receivable|prepaid|deposit|bank|cash|checking|due from/i.test(name)) {
    type = 'asset'; base = 1900
  }
  const used = new Set(chart.map(a => a.code))
  // Suffix rather than overflowing into another account-type block.
  let code = String(base)
  for (let i = 1; used.has(code); i++) code = `${base}.${i}`
  return { code, name, type, subtype }
}
