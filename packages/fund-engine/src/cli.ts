// The `fund-engine` command line. Pure: it takes the arguments and a way to read a file, and
// returns what to print — bin/fund-engine.mjs supplies the file system and the process.

import { parseLedgerText } from './text-ledger.ts'
import { parseVehicleTerms, type VehicleTerms } from './terms-file.ts'
import { statementsFromEntries, statementsTable, waterfallReport, waterfallTable } from './reports.ts'
import { verifyBundle, verifyTable } from './bundle.ts'

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
  fund-engine verify     --bundle <dir> [--expect-sha256 <hash>] [--format json|table]

statements  Capital-account roll-forward per partner, NAV, trial-balance check and the
            hypothetical-liquidation carry accrual, from a ledger exported by the app
            (export_ledger_text) or written by hand in the same format.
waterfall   How a distribution of <N> splits through the waterfall. With --ledger the tier
            state is replayed from prior distributions, as the app does; without it the
            terms file's "state" is used.
verify      Check a close's reproducibility bundle: every file against the manifest's SHA-256,
            and statements.json recomputed from books.ledger and terms.json. Exits 0 on a
            pass and 1 on a fail. --expect-sha256 also checks the bundle is the one recorded
            on the close (the SHA-256 of its manifest.json).
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

    if (args.command === 'verify') {
      const dir = stringFlag(args, 'bundle', true)!.replace(/\/+$/, '')
      const result = verifyBundle(name => read(`${dir}/${name}`), { expectSha256: stringFlag(args, 'expect-sha256', false) })
      return { code: result.ok ? 0 : 1, stdout: format === 'table' ? verifyTable(result) : JSON.stringify(result, null, 2) + '\n', stderr: '' }
    }

    return { code: 2, stdout: '', stderr: `Unknown command "${args.command}"\n\n${USAGE}` }
  } catch (e) {
    return { code: 1, stdout: '', stderr: `${(e as Error).message}\n` }
  }
}
