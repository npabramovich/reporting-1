import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import JSZip from 'jszip'
import { BUNDLE_FILES, sha256Hex } from '@hemrock/fund-engine'
import { bundleDirName, closeBundleZip, isMissingSchema, verifyStoredBundle, type StoredCloseBundle } from './close-bundle'

// The open engine's checked-in sample bundle (packages/fund-engine/examples/bundle), as the
// loader would return it from close_bundles.
const DIR = join(process.cwd(), 'packages/fund-engine/examples/bundle')
function stored(): StoredCloseBundle {
  const files: Record<string, string> = {}
  for (const name of Object.values(BUNDLE_FILES)) files[name] = readFileSync(join(DIR, name), 'utf8')
  const manifest = JSON.parse(files[BUNDLE_FILES.manifest])
  return {
    id: '00000000-0000-4000-8000-0000000000aa',
    fiscalPeriodId: manifest.subject.fiscalPeriodId,
    periodStart: manifest.subject.periodStart,
    periodEnd: manifest.subject.periodEnd,
    sha256: sha256Hex(files[BUNDLE_FILES.manifest]),
    createdAt: manifest.createdAt,
    manifest,
    files,
    current: true,
  }
}

describe('close bundle (app side)', () => {
  it('treats only missing-schema errors as "not deployed yet"', () => {
    for (const code of ['PGRST204', 'PGRST205', '42703', '42P01']) expect(isMissingSchema({ code })).toBe(true)
    expect(isMissingSchema({ code: '23505' })).toBe(false)
    expect(isMissingSchema(null)).toBe(false)
    expect(isMissingSchema({})).toBe(false)
  })

  it('verifies a stored bundle with the engine', () => {
    const r = verifyStoredBundle(stored())
    expect(r.ok).toBe(true)
  })

  it('fails a stored bundle whose ledger was altered', () => {
    const b = stored()
    b.files[BUNDLE_FILES.ledger] = b.files[BUNDLE_FILES.ledger].replace('2025-06', '2025-05')
    expect(verifyStoredBundle(b).ok).toBe(false)
  })

  it('fails a stored bundle whose recorded hash is not its manifest', () => {
    const b = stored()
    b.sha256 = sha256Hex('something else')
    expect(verifyStoredBundle(b).ok).toBe(false)
  })

  it('names the bundle directory safely', () => {
    expect(bundleDirName('Sample Fund I', '2025-06-30')).toBe('close-Sample-Fund-I-2025-06-30')
    expect(bundleDirName('a/../b', '2025-06-30')).not.toContain('/')
  })

  it('zips the bundle files byte-for-byte in one folder, with an unhashed VERIFY.txt', async () => {
    const b = stored()
    const { body, fileName } = await closeBundleZip(b, 'Sample Fund I')
    expect(fileName).toBe('close-Sample-Fund-I-2025-06-30.zip')
    const zip = await JSZip.loadAsync(body)
    const dir = 'close-Sample-Fund-I-2025-06-30/'
    for (const name of Object.values(BUNDLE_FILES)) {
      expect(await zip.file(dir + name)!.async('string')).toBe(b.files[name])
    }
    const verify = await zip.file(dir + 'VERIFY.txt')!.async('string')
    expect(verify).toContain(b.sha256)
    expect(verify).toContain('fund-engine.mjs verify --bundle')
    expect(Object.keys(b.manifest.files)).not.toContain('VERIFY.txt')
  })
})
