import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runCli, statementsReport, waterfallReport } from '../src/cli.ts'
import { booksFromText } from '../src/books.ts'
import { parseLedgerText, serializeLedger } from '../src/text-ledger.ts'
import { computeCapitalAccounts, type CapitalPosting } from '../src/capital-account.ts'
import { parseVehicleTerms } from '../src/terms-file.ts'
import { carryAccrualInputs, distributionSplitInputs } from '../src/economics.ts'
import { sampleAccounts, sampleEntries } from './fixture.ts'

const pkg = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (file: string) => readFileSync(path.resolve(pkg, file), 'utf8')
const ledger = read('examples/books.ledger')
const terms = parseVehicleTerms(JSON.parse(read('examples/terms.json')))

describe('booksFromText', () => {
  it('recovers the same capital accounts the app computes from its own rows', () => {
    // What the app's loader produces: postings to partner capital accounts, by entity id.
    const byId = new Map(sampleAccounts.map(a => [a.id, a]))
    const direct: CapitalPosting[] = []
    for (const e of sampleEntries) {
      if (e.status !== 'posted') continue
      for (const p of e.postings) {
        const lp = byId.get(p.accountId)?.lpEntityId
        if (lp) direct.push({ lpEntityId: lp.slice(0, 8), amount: p.amount, sourceType: e.sourceType, entryDate: e.entryDate })
      }
    }
    const books = booksFromText(parseLedgerText(ledger).entries)
    const fromText = computeCapitalAccounts(books.capitalPostings)
    const fromRows = computeCapitalAccounts(direct)
    // Unmapped capital accounts are keyed by their code, 3100-<first 8 of the entity id>.
    expect(new Map(Array.from(fromText.entries()).map(([k, v]) => [k.replace('3100-', ''), v]))).toEqual(fromRows)
  })

  it('leaves drafts and later entries out, and maps partners by account code', () => {
    const books = booksFromText(parseLedgerText(ledger).entries, { asOf: '2024-12-31', partners: terms.partners })
    expect(books.skippedDrafts).toBe(1)
    expect(books.skippedAfterAsOf).toBe(2)
    expect(new Set(books.capitalPostings.map(p => p.lpEntityId))).toEqual(new Set(['lp-alpha', 'lp-beta']))
  })
})

describe('statements', () => {
  it('a period statement carries earlier activity into beginning capital', () => {
    const r = statementsReport(ledger, terms, { from: '2025-01-01', asOf: '2025-12-31' })
    const alpha = r.partners.find(p => p.id === 'lp-alpha')!
    expect(alpha.capitalAccount.beginning).toBe(474000)
    expect(alpha.capitalAccount.distributions).toBe(-60000)
    expect(alpha.capitalAccount.ending).toBe(414000)
    expect(alpha.ties).toBe(true)
  })

  it('an as-of date before the mark shows the fund under water, with no carry', () => {
    const r = statementsReport(ledger, terms, { asOf: '2024-06-30' })
    expect(r.nav).toBe(490000)
    expect(r.carry!.target).toBe(0)
    expect(r.carry!.delta).toBe(0)
  })

  it('carry already booked to the recipient reduces what is left to post', () => {
    const extra = `\n2025-07-02 * "Carried interest accrued"\n  source: "carried_interest"\n` +
      `  Equity:Partners-Capital-Alpha-Pension:3100-aaaaaaaa  34800.00 USD\n` +
      `  Equity:Partners-Capital-Beta-Family-Office:3100-bbbbbbbb  23200.00 USD\n` +
      `  Equity:Partners-Capital-Sample-GP:3100-c0ffee00  -58000.00 USD\n`
    const r = statementsReport(ledger + extra, terms)
    // This mirrors the app's close (lib/accounting/close.ts) exactly: the LP NAV the target is
    // measured on is the capital balance AFTER earlier carry accruals, so a second run on unchanged
    // books measures 690k − 58k and proposes reversing 11.6k. lib/accounting/book-tax.ts adds the
    // accrued carry back before measuring (`ending − carriedInterest`), which would give delta 0.
    // Pinned here so a change to either side is a deliberate one; flagged for review.
    expect(r.carry).toMatchObject({ target: 46400, alreadyAccrued: 58000, delta: -11600 })
    expect(r.nav).toBe(690000)
    expect(r.partners.find(p => p.id === 'gp')!.capitalAccount.carriedInterest).toBe(58000)
  })

  it('refuses an unbalanced ledger rather than reporting on it', () => {
    const bad = '2024-01-01 * "Oops"\n  Assets:Cash:1000  100.00 USD\n  Equity:X:3100-zzzzzzzz  -90.00 USD\n'
    const out = runCli(['statements', '--ledger', 'bad', '--terms', 'terms'], f => (f === 'bad' ? bad : read('examples/terms.json')))
    expect(out.code).toBe(1)
    expect(out.stderr).toMatch(/does not balance/)
  })

  it('renders a table', () => {
    const out = runCli(['statements', '--ledger', 'examples/books.ledger', '--terms', 'examples/terms.json', '--format', 'table'], read)
    expect(out.code).toBe(0)
    expect(out.stdout).toMatch(/NAV: 690,000\.00/)
    expect(out.stdout).toMatch(/Every roll-forward ties: yes/)
  })
})

describe('waterfall', () => {
  it('without a ledger, runs from the terms file state', () => {
    const t = parseVehicleTerms({
      carry: { kind: 'european', carryRate: 0.2, prefRate: 0.08, catchupRate: 1, recipients: [{ partner: 'gp', pct: 100 }] },
      partners: [{ id: 'a', commitment: 75 }, { id: 'b', commitment: 25 }],
      state: { contributedCapital: 1000, preferredTarget: 80 },
    })
    const r = waterfallReport(t, 1500)
    expect(r.tiers).toMatchObject({ returnOfCapital: 1000, preferred: 80, catchUp: 20, carry: 80, profitToLP: 320, toLP: 1400, toGP: 100 })
    expect(r.lines).toEqual([{ partner: 'a', name: 'a', amount: 1050 }, { partner: 'b', name: 'b', amount: 350 }])
    expect(r.carryLines).toEqual([{ partner: 'gp', name: 'gp', amount: 100 }])
  })

  it('straight carry has no hurdle', () => {
    const t = parseVehicleTerms({ carry: { kind: 'straight', carryRate: 0.2, recipients: [{ partner: 'gp', pct: 100 }] }, state: { contributedCapital: 100, preferredTarget: 50 } })
    const r = waterfallReport(t, 200)
    expect(r.tiers).toMatchObject({ returnOfCapital: 100, preferred: 0, catchUp: 0, carry: 20, toGP: 20, toLP: 180 })
  })

  it('a usage error exits 2', () => {
    expect(runCli(['bogus'], read).code).toBe(2)
    expect(runCli([], read).code).toBe(2)
    expect(runCli(['--help'], read).code).toBe(0)
    expect(runCli(['waterfall', '--terms', 'examples/terms.json'], read)).toMatchObject({ code: 1, stderr: '--amount is required\n' })
  })
})

describe('terms.json', () => {
  it('rejects a percentage written as a whole number', () => {
    expect(() => parseVehicleTerms({ carry: { kind: 'european', carryRate: 20 } })).toThrow(/fraction/)
  })
  it('rejects recipients that do not sum to 100', () => {
    expect(() => parseVehicleTerms({ carry: { kind: 'european', carryRate: 0.2, recipients: [{ partner: 'gp', pct: 60 }] } })).toThrow(/sum to 100/)
  })
  it('accepts the stored snake_case row', () => {
    const t = parseVehicleTerms({ carry: { kind: 'american', carry_rate: 0.25, pref_rate: 0.06, catchup_rate: 0.8, pref_compounds: false, gp_entity_id: 'gp' } })
    expect(t.carry).toEqual({ kind: 'american', carryRate: 0.25, prefRate: 0.06, catchupRate: 0.8, prefCompounds: false, gpEntityId: 'gp', recipients: [{ lpEntityId: 'gp', pct: 100 }] })
  })
})

describe('economics', () => {
  const postings: CapitalPosting[] = [
    { lpEntityId: 'lp', amount: -100, sourceType: 'capital_call', entryDate: '2024-01-01' },
    { lpEntityId: 'gp', amount: -10, sourceType: 'capital_call', entryDate: '2024-01-01' },
    { lpEntityId: 'gp', amount: -5, sourceType: 'carried_interest', entryDate: '2024-12-31' },
    { lpEntityId: 'lp', amount: 5, sourceType: 'carried_interest', entryDate: '2024-12-31' },
    { lpEntityId: 'lp', amount: 30, sourceType: 'distribution', entryDate: '2025-01-15' },
    { lpEntityId: 'gp', amount: 4, sourceType: 'carry_distribution', entryDate: '2025-01-15' },
  ]
  const recipients = [{ lpEntityId: 'gp', pct: 100 }]

  it('carryAccrualInputs keeps the recipients out of the hurdle and reads what is accrued', () => {
    const i = carryAccrualInputs(postings, recipients, '2025-06-30')
    expect(i.alreadyAccrued).toBe(1) // 5 accrued, 4 paid out
    expect(i.lps).toEqual([{ lpEntityId: 'lp', contributed: 100, distributed: 30, nav: 65 }])
    expect(i.contributions).toEqual([{ date: '2024-01-01', amount: 100 }])
  })

  it('distributionSplitInputs totals every prior distribution, carry included, by date', () => {
    const i = distributionSplitInputs(postings, recipients, '2025-06-30')
    expect(i.priors).toEqual([{ date: '2025-01-15', amount: 34 }])
    expect(i.carryPaidToDate).toBe(4)
    expect(i.partners.map(p => p.lpEntityId).sort()).toEqual(['gp', 'lp'])
    expect(distributionSplitInputs(postings, recipients, '2025-01-01').priors).toEqual([])
  })
})

it('serializeLedger → parseLedgerText → booksFromText keeps the trial balance', () => {
  const books = booksFromText(parseLedgerText(serializeLedger(sampleAccounts, sampleEntries)).entries, { includeDrafts: true })
  const sum = books.postings.reduce((s, p) => s + p.amount, 0)
  expect(Math.round(sum * 100)).toBe(0)
  expect(books.included).toBe(sampleEntries.length)
})
