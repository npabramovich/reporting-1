import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runCli } from '../src/cli.ts'
import { serializeLedger } from '../src/text-ledger.ts'
import { sampleAccounts, sampleEntries } from './fixture.ts'

const pkg = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (file: string) => readFileSync(path.resolve(pkg, file), 'utf8')

describe('examples/ — the golden sample', () => {
  it('books.ledger is exactly what the app’s serializer writes for the sample books', () => {
    expect(read('examples/books.ledger')).toBe(serializeLedger(sampleAccounts, sampleEntries))
  })

  it('statements matches expected-statements.json', () => {
    const out = runCli(['statements', '--ledger', 'examples/books.ledger', '--terms', 'examples/terms.json'], read)
    expect(out.stderr).toBe('')
    expect(out.code).toBe(0)
    expect(out.stdout).toBe(read('examples/expected-statements.json'))
  })

  it('waterfall matches expected-waterfall.json', () => {
    const out = runCli(['waterfall', '--ledger', 'examples/books.ledger', '--terms', 'examples/terms.json', '--amount', '600000'], read)
    expect(out.stderr).toBe('')
    expect(out.code).toBe(0)
    expect(out.stdout).toBe(read('examples/expected-waterfall.json'))
  })

  it('the golden numbers are the ones the LPA implies', () => {
    const s = JSON.parse(read('examples/expected-statements.json'))
    expect(s.nav).toBe(690000)
    expect(s.checks).toMatchObject({ trialBalanceBalanced: true, everyRollForwardTies: true, navTiesToLedger: true })
    // 790k liquidation value on 500k contributed: 290k profit, full catch-up → 20% of it.
    expect(s.carry.target).toBe(58000)
    expect(s.carry.perPartner).toEqual({ 'lp-alpha': 34800, 'lp-beta': 23200 })

    const w = JSON.parse(read('examples/expected-waterfall.json'))
    expect(w.tiers.toLP + w.tiers.toGP).toBe(600000)
    // 400k of capital is still out after the 100k distribution, so that comes back first.
    expect(w.tiers.returnOfCapital).toBe(400000)
    // Catch-up gives the GP 20% of (pref + catch-up).
    expect(w.tiers.catchUp).toBeCloseTo(w.tiers.preferred / 4, 1)
  })

  it('the bin runs the same engine end to end', () => {
    const stdout = execFileSync(process.execPath, [
      '--experimental-strip-types',
      path.join(pkg, 'bin/fund-engine.mjs'),
      'statements', '--ledger', 'examples/books.ledger', '--terms', 'examples/terms.json',
    ], { cwd: pkg, encoding: 'utf8' })
    expect(stdout).toBe(read('examples/expected-statements.json'))
  })
})
