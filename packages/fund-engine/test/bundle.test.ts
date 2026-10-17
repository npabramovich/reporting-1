import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { sha256Hex } from '../src/sha256.ts'
import { verifyBundle, termsFileFrom, BUNDLE_FILES } from '../src/bundle.ts'
import { parseVehicleTerms } from '../src/terms-file.ts'
import { runCli } from '../src/cli.ts'
import { ENGINE_VERSION } from '../src/version.ts'
import { sampleBundle } from './bundle-fixture.ts'

const pkg = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (file: string) => readFileSync(path.resolve(pkg, file), 'utf8')

describe('sha256', () => {
  it('matches the standard vectors and node:crypto, multi-byte text included', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    const samples = ['x'.repeat(55), 'x'.repeat(56), 'x'.repeat(64), 'x'.repeat(1000), 'Partners’ capital — €1,000 ✓ 😀', 'line\nbreak\ttab']
    for (const s of samples) expect(sha256Hex(s)).toBe(createHash('sha256').update(s, 'utf8').digest('hex'))
  })
})

describe('close bundle', () => {
  const bundle = sampleBundle()
  const memory = (files: Record<string, string>) => (name: string) => {
    if (!(name in files)) throw new Error(`missing ${name}`)
    return files[name]
  }

  it('examples/bundle is exactly what buildBundle writes for the sample close', () => {
    for (const [name, text] of Object.entries(bundle.files)) expect(read(`examples/bundle/${name}`), name).toBe(text)
  })

  it('records the engine version from package.json', () => {
    expect(ENGINE_VERSION).toBe(JSON.parse(read('package.json')).version)
    expect(bundle.manifest.engine.version).toBe(ENGINE_VERSION)
  })

  it('the terms file reads back to the carry terms the close used', () => {
    const carry = { kind: 'european' as const, carryRate: 0.2, prefRate: 0.08, catchupRate: 0.8, prefCompounds: false, gpEntityId: 'gp', recipients: [{ lpEntityId: 'gp', pct: 60 }, { lpEntityId: 'gp2', pct: 40 }] }
    const file = termsFileFrom({ vehicle: 'V', carry, partners: [{ id: 'b', commitment: 1 }, { id: 'a', name: 'A', account: '3100-a' }] })
    expect(parseVehicleTerms(file).carry).toEqual(carry)
    expect((file.partners as any[]).map(p => p.id)).toEqual(['a', 'b'])
  })

  it('verifies: every hash matches and the statements recompute', () => {
    const r = verifyBundle(memory(bundle.files), { expectSha256: bundle.sha256 })
    expect(r.ok).toBe(true)
    expect(r.bundleSha256).toBe(bundle.sha256)
    expect(r.checks.map(c => c.name)).toEqual(expect.arrayContaining(['manifest', 'bundle hash', 'file books.ledger', 'file terms.json', 'file statements.json', 'recompute', 'trial balance', 'roll-forward', 'engine']))
  })

  it('fails a ledger changed after the close', () => {
    const tampered = { ...bundle.files, [BUNDLE_FILES.ledger]: bundle.files[BUNDLE_FILES.ledger].replace('-300000.00 USD', '-310000.00 USD') }
    const r = verifyBundle(memory(tampered))
    expect(r.ok).toBe(false)
    expect(r.checks.find(c => c.name === 'file books.ledger')!.ok).toBe(false)
  })

  it('fails even when the tamperer also rewrites the manifest — the statements no longer recompute, and the bundle hash moves', () => {
    const ledger = bundle.files[BUNDLE_FILES.ledger].replace(/-300000\.00 USD/, '-310000.00 USD').replace(/500000\.00 USD/, '510000.00 USD')
    const manifest = JSON.parse(bundle.files[BUNDLE_FILES.manifest])
    manifest.files[BUNDLE_FILES.ledger] = { sha256: sha256Hex(ledger), bytes: Buffer.byteLength(ledger) }
    const files = { ...bundle.files, [BUNDLE_FILES.ledger]: ledger, [BUNDLE_FILES.manifest]: JSON.stringify(manifest, null, 2) + '\n' }
    const r = verifyBundle(memory(files), { expectSha256: bundle.sha256 })
    expect(r.ok).toBe(false)
    expect(r.checks.find(c => c.name === 'file books.ledger')!.ok).toBe(true)
    expect(r.checks.find(c => c.name === 'recompute')!.ok).toBe(false)
    expect(r.checks.find(c => c.name === 'bundle hash')!.ok).toBe(false)
  })

  it('fails edited statements, a missing file, and a file name that leaves the directory', () => {
    const edited = { ...bundle.files, [BUNDLE_FILES.statements]: bundle.files[BUNDLE_FILES.statements].replace('"nav": 690000', '"nav": 700000') }
    expect(verifyBundle(memory(edited)).ok).toBe(false)
    const { [BUNDLE_FILES.terms]: _terms, ...missing } = bundle.files
    void _terms
    const r = verifyBundle(memory(missing))
    expect(r.ok).toBe(false)
    expect(r.checks.find(c => c.name === 'file terms.json')!.detail).toMatch(/missing/)
    const manifest = JSON.parse(bundle.files[BUNDLE_FILES.manifest])
    manifest.files['../secret'] = { sha256: 'x', bytes: 1 }
    expect(verifyBundle(memory({ ...bundle.files, [BUNDLE_FILES.manifest]: JSON.stringify(manifest) })).checks.some(c => c.name === 'file ../secret' && !c.ok)).toBe(true)
  })

  it('the CLI passes the example bundle and exits 1 on a tampered copy', () => {
    const ok = runCli(['verify', '--bundle', 'examples/bundle/', '--expect-sha256', bundle.sha256], read)
    expect(ok.code).toBe(0)
    expect(JSON.parse(ok.stdout).ok).toBe(true)
    const bad = runCli(['verify', '--bundle', 'examples/bundle'], f => (f.endsWith(BUNDLE_FILES.statements) ? read(f).replace('690000', '690001') : read(f)))
    expect(bad.code).toBe(1)
    expect(runCli(['verify', '--bundle', 'examples/bundle', '--format', 'table'], read).stdout).toMatch(/^PASS/)
  })

  it('the bin verifies the example bundle end to end', () => {
    const stdout = execFileSync(process.execPath, ['--experimental-strip-types', path.join(pkg, 'bin/fund-engine.mjs'), 'verify', '--bundle', 'examples/bundle', '--format', 'table'], { cwd: pkg, encoding: 'utf8' })
    expect(stdout).toMatch(/^PASS/)
  })
})
