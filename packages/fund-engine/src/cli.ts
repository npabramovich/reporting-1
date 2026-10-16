// The `fund-engine` command line. Pure: it takes the arguments and a way to read a file, and
// returns what to print — bin/fund-engine.mjs supplies the file system and the process.

import { parseLedgerText } from './text-ledger.ts'
import { booksFromText } from './books.ts'
import { trialBalance } from './trial-balance.ts'
import {
  ACTIVITY_FIELDS,
  CAPITAL_ACCOUNT_LABELS,
  computeCapitalAccounts,
  emptyAccount,
  rollForwardTies,
  totalNav,
  type CapitalAccount,
} from './capital-account.ts'
import { carryAccrual } from './carry.ts'
import { carryAccrualInputs, distributionSplitInputs } from './economics.ts'
import { splitDistribution, suggestedCharacter } from './distribution-waterfall.ts'
import { runWaterfall, type WaterfallState } from './waterfall.ts'
import { allocateAmount } from './allocation.ts'
import { roundCents } from './ledger.ts'
import { parseVehicleTerms, type VehicleTerms } from './terms-file.ts'

export interface CliResult {
  code: number
  stdout: string
  stderr: string
}

export type ReadText = (path: string) => string

export const USAGE = `fund-engine — open fund-accounting math over plain-text books

Usage:
  fund-engine statements --ledger <books.ledger> --terms <terms.json> [--as-of YYYY-MM-DD]
                         [--from YYYY-MM-DD] [--include-drafts] [--format json|table]
  fund-engine waterfall  --terms <terms.json> --amount <N> [--ledger <books.ledger>]
                         [--as-of YYYY-MM-DD] [--format json|table]

statements  Capital-account roll-forward per partner, NAV, trial-balance check and the
            hypothetical-liquidation carry accrual, from a ledger exported by the app
            (export_ledger_text) or written by hand in the same format.
waterfall   How a distribution of <N> splits through the waterfall. With --ledger the tier
            state is replayed from prior distributions, as the app does; without it the
            terms file's "state" is used.
`

interface Args {
  command: string | null
  flags: Map<string, string | true>
}

const BOOLEAN_FLAGS = new Set(['include-drafts', 'help'])

function parseArgs(argv: string[]): Args {
  const flags = new Map<string, string | true>()
  let command: string | null = null
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '-h') { flags.set('help', true); continue }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=')
      const key = eq > 0 ? a.slice(2, eq) : a.slice(2)
      if (eq > 0) { flags.set(key, a.slice(eq + 1)); continue }
      if (BOOLEAN_FLAGS.has(key)) { flags.set(key, true); continue }
      const value = argv[i + 1]
      if (value === undefined || value.startsWith('--')) throw new Error(`--${key} needs a value`)
      flags.set(key, value)
      i++
      continue
    }
    if (command === null) command = a
    else throw new Error(`Unexpected argument "${a}"`)
  }
  return { command, flags }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function dateFlag(args: Args, name: string): string | null {
  const v = args.flags.get(name)
  if (v === undefined) return null
  if (typeof v !== 'string' || !DATE_RE.test(v) || Number.isNaN(Date.parse(v))) throw new Error(`--${name} must be a date (YYYY-MM-DD)`)
  return v
}

function stringFlag(args: Args, name: string, required: boolean): string | null {
  const v = args.flags.get(name)
  if (v === undefined) {
    if (required) throw new Error(`--${name} is required`)
    return null
  }
  if (typeof v !== 'string') throw new Error(`--${name} needs a value`)
  return v
}

function readTerms(read: ReadText, path: string): VehicleTerms {
  let raw: unknown
  try { raw = JSON.parse(read(path)) } catch (e) { throw new Error(`Could not read terms ${path}: ${(e as Error).message}`) }
  return parseVehicleTerms(raw)
}

function readLedger(read: ReadText, path: string) {
  const parsed = parseLedgerText(read(path))
  if (parsed.errors.length > 0) {
    throw new Error(`The ledger ${path} has ${parsed.errors.length} error(s):\n  ${parsed.errors.join('\n  ')}`)
  }
  return parsed.entries
}

function lastDate(dates: string[]): string | null {
  return dates.length === 0 ? null : dates.reduce((a, b) => (b > a ? b : a))
}

function sortedObject(map: Map<string, number>): Record<string, number> {
  return Object.fromEntries(Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b)))
}

// ---------------------------------------------------------------------------------------------
// statements

export interface StatementsReport {
  vehicle: string | null
  asOf: string
  from: string | null
  entries: { included: number; skippedDrafts: number; skippedAfterAsOf: number }
  currencies: string[]
  trialBalance: {
    rows: { code: string; name: string; type: string; debit: number; credit: number; balance: number }[]
    totalDebits: number
    totalCredits: number
    balanced: boolean
  }
  partners: {
    id: string
    name: string
    account: string | null
    commitment: number | null
    carryRecipient: boolean
    capitalAccount: CapitalAccount
    ties: boolean
  }[]
  nav: number
  checks: {
    trialBalanceBalanced: boolean
    everyRollForwardTies: boolean
    /** Σ partner ending capital = the partner capital accounts' balance in the trial balance. */
    navTiesToLedger: boolean
    ledgerPartnerCapital: number
  }
  carry: null | {
    kind: string
    carryRate: number
    prefRate: number
    catchupRate: number
    prefCompounds: boolean
    target: number
    alreadyAccrued: number
    delta: number
    perPartner: Record<string, number>
  }
  warnings: string[]
}

export function statementsReport(
  ledgerText: string,
  terms: VehicleTerms,
  opts: { asOf?: string | null; from?: string | null; includeDrafts?: boolean } = {},
): StatementsReport {
  const parsed = parseLedgerText(ledgerText)
  if (parsed.errors.length > 0) throw new Error(`The ledger has ${parsed.errors.length} error(s):\n  ${parsed.errors.join('\n  ')}`)
  return statementsFromEntries(parsed.entries, terms, opts)
}

function statementsFromEntries(
  entries: ReturnType<typeof parseLedgerText>['entries'],
  terms: VehicleTerms,
  opts: { asOf?: string | null; from?: string | null; includeDrafts?: boolean },
): StatementsReport {
  const warnings: string[] = []
  const considered = entries.filter(e => e.flag === '*' || opts.includeDrafts)
  const asOf = opts.asOf ?? lastDate(considered.map(e => e.date))
  if (!asOf) throw new Error('The ledger has no posted entries; pass --as-of, or --include-drafts to count drafts')
  const from = opts.from ?? null
  if (from && from > asOf) throw new Error('--from is after --as-of')

  const books = booksFromText(entries, {
    asOf,
    includeDrafts: opts.includeDrafts,
    capitalAccountPattern: terms.capitalAccountPattern,
    partners: terms.partners,
  })
  if (books.currencies.length > 1) {
    warnings.push(`The ledger has postings in ${books.currencies.join(', ')}; the roll-forward sums them as one currency, as the app's capital account does.`)
  }
  for (const name of books.unknownRoots) warnings.push(`Account ${name} has no recognised root (Assets, Liabilities, Equity, Income, Expenses); treated as an asset.`)
  if (books.skippedDrafts > 0) warnings.push(`${books.skippedDrafts} draft entr${books.skippedDrafts === 1 ? 'y was' : 'ies were'} left out; pass --include-drafts to count them.`)

  const tb = trialBalance(books.accounts, books.postings)
  const accountById = new Map(books.accounts.map(a => [a.id, a]))
  const ledgerPartnerCapital = roundCents(
    tb.rows.filter(r => accountById.get(r.accountId)?.lpEntityId).reduce((s, r) => s + r.balance, 0),
  )

  const capital = computeCapitalAccounts(books.capitalPostings, { start: from, end: asOf })
  const termsById = new Map(terms.partners.map(p => [p.id, p]))
  const accountByPartner = new Map(Array.from(books.partnerByAccount.entries()).map(([code, id]) => [id, code]))
  const recipientIds = new Set(terms.carry.recipients.map(r => r.lpEntityId))

  const ids = new Set<string>([...Array.from(capital.keys()), ...terms.partners.map(p => p.id)])
  const partners = Array.from(ids).sort().map(id => {
    const t = termsById.get(id)
    const account = accountByPartner.get(id) ?? t?.account ?? null
    const capitalAccount = capital.get(id) ?? emptyAccount()
    return {
      id,
      name: t?.name ?? (account ? books.accountNames.get(account) ?? id : id),
      account,
      commitment: t?.commitment ?? null,
      carryRecipient: recipientIds.has(id),
      capitalAccount,
      ties: rollForwardTies(capitalAccount),
    }
  })
  for (const r of terms.carry.recipients) {
    if (!ids.has(r.lpEntityId)) warnings.push(`Carry recipient ${r.lpEntityId} has no capital account in the ledger and is not listed in partners.`)
  }

  const nav = totalNav(capital)

  let carry: StatementsReport['carry'] = null
  const t = terms.carry
  if (t.kind !== 'none' && t.carryRate > 0) {
    if (t.recipients.length === 0) {
      warnings.push('Carry terms are set but no recipient is named, so no carry accrual is computed (the close refuses the same way).')
    } else {
      const inputs = carryAccrualInputs(books.capitalPostings, t.recipients, asOf)
      const accrual = inputs.lps.length === 0
        ? { target: 0, alreadyAccrued: inputs.alreadyAccrued, delta: 0, perLp: new Map<string, number>() }
        : carryAccrual({ lps: inputs.lps, contributions: inputs.contributions, asOf }, t, inputs.alreadyAccrued)
      carry = {
        kind: t.kind,
        carryRate: t.carryRate,
        prefRate: t.prefRate,
        catchupRate: t.catchupRate,
        prefCompounds: t.prefCompounds,
        target: accrual.target,
        alreadyAccrued: accrual.alreadyAccrued,
        delta: accrual.delta,
        perPartner: sortedObject(accrual.perLp),
      }
    }
  }

  return {
    vehicle: terms.vehicle ?? null,
    asOf,
    from,
    entries: { included: books.included, skippedDrafts: books.skippedDrafts, skippedAfterAsOf: books.skippedAfterAsOf },
    currencies: books.currencies,
    trialBalance: {
      rows: tb.rows.map(r => ({ code: r.code, name: r.name, type: r.type, debit: r.debit, credit: r.credit, balance: r.balance })),
      totalDebits: tb.totalDebits,
      totalCredits: tb.totalCredits,
      balanced: tb.balanced,
    },
    partners,
    nav,
    checks: {
      trialBalanceBalanced: tb.balanced,
      everyRollForwardTies: partners.every(p => p.ties),
      // Only meaningful for an inception-to-date view: a period statement's `beginning` is still
      // part of `ending`, so it ties either way.
      navTiesToLedger: Math.abs(roundCents(nav - ledgerPartnerCapital)) < 0.005,
      ledgerPartnerCapital,
    },
    carry,
    warnings,
  }
}

// ---------------------------------------------------------------------------------------------
// waterfall

export interface WaterfallReport {
  vehicle: string | null
  asOf: string | null
  amount: number
  method: string
  source: 'ledger' | 'terms-state'
  tiers: {
    returnOfCapital: number
    preferred: number
    catchUp: number
    carry: number
    profitToLP: number
    toLP: number
    toGP: number
  }
  lines: { partner: string; name: string; amount: number }[]
  carryLines: { partner: string; name: string; amount: number }[]
  suggestedCharacter: { returnOfCapital: number; realizedGain: number; income: number }
  stateBefore: WaterfallState
  stateAfter: WaterfallState
  warnings: string[]
}

export function waterfallReport(
  terms: VehicleTerms,
  amount: number,
  opts: { ledgerText?: string | null; asOf?: string | null } = {},
): WaterfallReport {
  const total = roundCents(amount)
  const nameOf = (id: string) => terms.partners.find(p => p.id === id)?.name ?? id

  if (opts.ledgerText != null) {
    const parsed = parseLedgerText(opts.ledgerText)
    if (parsed.errors.length > 0) throw new Error(`The ledger has ${parsed.errors.length} error(s):\n  ${parsed.errors.join('\n  ')}`)
    const asOf = opts.asOf ?? lastDate(parsed.entries.filter(e => e.flag === '*').map(e => e.date))
    if (!asOf) throw new Error('The ledger has no posted entries; pass --as-of')
    const books = booksFromText(parsed.entries, { asOf, capitalAccountPattern: terms.capitalAccountPattern, partners: terms.partners })
    const accountNames = new Map(Array.from(books.partnerByAccount.entries()).map(([code, id]) => [id, books.accountNames.get(code) ?? id]))
    const label = (id: string) => terms.partners.find(p => p.id === id)?.name ?? accountNames.get(id) ?? id

    const inputs = distributionSplitInputs(books.capitalPostings, terms.carry.recipients, asOf)
    const split = splitDistribution({
      total,
      terms: terms.carry,
      partners: inputs.partners,
      contributions: inputs.contributions,
      priors: inputs.priors,
      asOf,
      carryPaidToDate: terms.carry.recipients.length > 0 ? inputs.carryPaidToDate : undefined,
    })
    return {
      vehicle: terms.vehicle ?? null,
      asOf,
      amount: total,
      method: split.method,
      source: 'ledger',
      tiers: split.tiers,
      lines: split.lines.map(l => ({ partner: l.lpEntityId, name: label(l.lpEntityId), amount: l.amount })),
      carryLines: split.carryLines.map(l => ({ partner: l.lpEntityId, name: label(l.lpEntityId), amount: l.amount })),
      suggestedCharacter: suggestedCharacter(split.tiers, total),
      stateBefore: split.stateBefore,
      stateAfter: split.stateAfter,
      warnings: split.warnings,
    }
  }

  // No ledger: run the waterfall once from the terms file's cumulative state.
  const warnings: string[] = []
  const t = terms.carry
  const zero: WaterfallState = { contributedCapital: 0, returnedCapital: 0, preferredPaid: 0, preferredTarget: 0, gpCarryPaid: 0 }
  const stateIn: WaterfallState = terms.state ?? zero
  if (!terms.state) warnings.push('No "state" in the terms file and no --ledger: the waterfall starts from zero contributed capital, so every dollar is profit.')
  const noCarry = t.kind === 'none' || t.carryRate <= 0
  const state: WaterfallState = t.kind === 'straight' ? { ...stateIn, preferredTarget: 0 } : stateIn
  const result = noCarry
    ? { toReturnOfCapital: 0, toPreferred: 0, toCatchUp: 0, toCarryGP: 0, toCarryLP: 0, toLP: total, toGP: 0, state }
    : runWaterfall(total, { carryRate: t.carryRate, catchUpRate: t.kind === 'straight' ? 1 : t.catchupRate }, state)
  const tiers = {
    returnOfCapital: result.toReturnOfCapital,
    preferred: result.toPreferred,
    catchUp: result.toCatchUp,
    carry: result.toCarryGP,
    profitToLP: result.toCarryLP,
    toLP: result.toLP,
    toGP: result.toGP,
  }

  // LP lines pro-rata by commitment — the only basis a terms file has.
  const recipientIds = new Set(t.recipients.map(r => r.lpEntityId))
  const lps = terms.partners.filter(p => !recipientIds.has(p.id) && (p.commitment ?? 0) > 0)
  if (lps.length === 0 && tiers.toLP > 0) warnings.push('No partner with a commitment in the terms file, so the LP share is not split by partner.')
  const lines = lps.length === 0 || tiers.toLP <= 0 ? [] : Array.from(
    allocateAmount(tiers.toLP, lps.map(p => ({ lpEntityId: p.id, commitment: p.commitment ?? 0 }))).entries(),
  ).map(([id, amt]) => ({ partner: id, name: nameOf(id), amount: amt })).filter(l => l.amount > 0)

  const carryLines: WaterfallReport['carryLines'] = []
  if (tiers.toGP > 0) {
    if (t.recipients.length === 0) warnings.push('The GP share is not split: no carry recipient is named.')
    let allocated = 0
    t.recipients.forEach((r, i) => {
      const amt = i === t.recipients.length - 1 ? roundCents(tiers.toGP - allocated) : roundCents((tiers.toGP * r.pct) / 100)
      allocated = roundCents(allocated + amt)
      if (amt > 0) carryLines.push({ partner: r.lpEntityId, name: nameOf(r.lpEntityId), amount: amt })
    })
  }

  return {
    vehicle: terms.vehicle ?? null,
    asOf: opts.asOf ?? null,
    amount: total,
    method: noCarry ? 'pro_rata' : 'waterfall',
    source: 'terms-state',
    tiers,
    lines,
    carryLines,
    suggestedCharacter: suggestedCharacter(tiers, total),
    stateBefore: state,
    stateAfter: result.state,
    warnings,
  }
}

// ---------------------------------------------------------------------------------------------
// table output

function money(n: number): string {
  const s = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return n < 0 ? `(${s})` : s
}

function table(header: string[], rows: string[][], numericFrom = 1): string {
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map(r => (r[i] ?? '').length)))
  const fmt = (r: string[]) => r.map((c, i) => (i >= numericFrom ? c.padStart(widths[i]) : c.padEnd(widths[i]))).join('  ')
  return [fmt(header), widths.map(w => '-'.repeat(w)).join('  '), ...rows.map(fmt)].join('\n')
}

export function statementsTable(r: StatementsReport): string {
  const out: string[] = []
  out.push(`${r.vehicle ?? 'Vehicle'} — statements as of ${r.asOf}${r.from ? ` (period from ${r.from})` : ''}`)
  out.push(`${r.entries.included} entries included`)
  out.push('')
  out.push('Trial balance')
  out.push(table(['Code', 'Account', 'Debit', 'Credit'], [
    ...r.trialBalance.rows.map(x => [x.code, x.name, x.debit ? money(x.debit) : '', x.credit ? money(x.credit) : '']),
    ['', 'Total', money(r.trialBalance.totalDebits), money(r.trialBalance.totalCredits)],
  ], 2))
  out.push('')
  out.push("Partners' capital roll-forward")
  const fields: (keyof CapitalAccount)[] = ['beginning', ...ACTIVITY_FIELDS, 'ending']
  const used = fields.filter(f => f === 'beginning' || f === 'ending' || r.partners.some(p => p.capitalAccount[f] !== 0))
  out.push(table(['', ...r.partners.map(p => p.name), 'Total'], used.map(f => [
    CAPITAL_ACCOUNT_LABELS[f],
    ...r.partners.map(p => money(p.capitalAccount[f])),
    money(roundCents(r.partners.reduce((s, p) => s + p.capitalAccount[f], 0))),
  ])))
  out.push('')
  out.push(`NAV: ${money(r.nav)}`)
  out.push(`Trial balance balances: ${r.checks.trialBalanceBalanced ? 'yes' : 'NO'}`)
  out.push(`Every roll-forward ties: ${r.checks.everyRollForwardTies ? 'yes' : 'NO'}`)
  out.push(`NAV ties to partner capital in the ledger (${money(r.checks.ledgerPartnerCapital)}): ${r.checks.navTiesToLedger ? 'yes' : 'NO'}`)
  if (r.carry) {
    out.push('')
    out.push(`Carried interest (${r.carry.kind}, ${r.carry.carryRate * 100}% carry, ${r.carry.prefRate * 100}% pref) — hypothetical liquidation at ${r.asOf}`)
    out.push(table(['', 'Amount'], [
      ['Target entitlement', money(r.carry.target)],
      ['Already accrued', money(r.carry.alreadyAccrued)],
      ['To post', money(r.carry.delta)],
      ...Object.entries(r.carry.perPartner).map(([id, amt]) => [`  charged to ${r.partners.find(p => p.id === id)?.name ?? id}`, money(amt)]),
    ]))
  }
  if (r.warnings.length) { out.push(''); out.push('Warnings:'); for (const w of r.warnings) out.push(`  - ${w}`) }
  return out.join('\n') + '\n'
}

export function waterfallTable(r: WaterfallReport): string {
  const out: string[] = []
  out.push(`${r.vehicle ?? 'Vehicle'} — distribution of ${money(r.amount)}${r.asOf ? ` on ${r.asOf}` : ''} (${r.method}, state from ${r.source})`)
  out.push('')
  out.push(table(['Tier', 'Amount'], [
    ['Return of capital', money(r.tiers.returnOfCapital)],
    ['Preferred return', money(r.tiers.preferred)],
    ['GP catch-up', money(r.tiers.catchUp)],
    ['Carry split — GP', money(r.tiers.carry)],
    ['Carry split — LPs', money(r.tiers.profitToLP)],
    ['To LPs', money(r.tiers.toLP)],
    ['To GP', money(r.tiers.toGP)],
  ]))
  out.push('')
  out.push(table(['Partner', 'Kind', 'Amount'], [
    ...r.lines.map(l => [l.name, 'distribution', money(l.amount)]),
    ...r.carryLines.map(l => [l.name, 'carry', money(l.amount)]),
  ], 2))
  if (r.warnings.length) { out.push(''); out.push('Warnings:'); for (const w of r.warnings) out.push(`  - ${w}`) }
  return out.join('\n') + '\n'
}

// ---------------------------------------------------------------------------------------------

export function runCli(argv: string[], read: ReadText): CliResult {
  let args: Args
  try { args = parseArgs(argv) } catch (e) { return { code: 2, stdout: '', stderr: `${(e as Error).message}\n\n${USAGE}` } }
  if (args.flags.has('help') || args.command === null || args.command === 'help') return { code: args.command === null && !args.flags.has('help') ? 2 : 0, stdout: USAGE, stderr: '' }

  try {
    const format = stringFlag(args, 'format', false) ?? 'json'
    if (format !== 'json' && format !== 'table') throw new Error('--format must be json or table')

    if (args.command === 'statements') {
      const terms = readTerms(read, stringFlag(args, 'terms', true)!)
      const entries = readLedger(read, stringFlag(args, 'ledger', true)!)
      const report = statementsFromEntries(entries, terms, {
        asOf: dateFlag(args, 'as-of'),
        from: dateFlag(args, 'from'),
        includeDrafts: args.flags.get('include-drafts') === true,
      })
      return { code: 0, stdout: format === 'table' ? statementsTable(report) : JSON.stringify(report, null, 2) + '\n', stderr: '' }
    }

    if (args.command === 'waterfall') {
      const terms = readTerms(read, stringFlag(args, 'terms', true)!)
      const amountRaw = stringFlag(args, 'amount', true)!
      const amount = Number(amountRaw.replace(/,/g, ''))
      if (!Number.isFinite(amount) || amount < 0) throw new Error('--amount must be a non-negative number')
      const ledgerPath = stringFlag(args, 'ledger', false)
      const report = waterfallReport(terms, amount, {
        ledgerText: ledgerPath ? read(ledgerPath) : null,
        asOf: dateFlag(args, 'as-of'),
      })
      return { code: 0, stdout: format === 'table' ? waterfallTable(report) : JSON.stringify(report, null, 2) + '\n', stderr: '' }
    }

    return { code: 2, stdout: '', stderr: `Unknown command "${args.command}"\n\n${USAGE}` }
  } catch (e) {
    return { code: 1, stdout: '', stderr: `${(e as Error).message}\n` }
  }
}
