import { describe, it, expect } from 'vitest'
import { readdirSync } from 'fs'
import { join } from 'path'
import { GP_APP_SEGMENTS, isGpAppPath } from './gp-app-routes'

describe('GP_APP_SEGMENTS', () => {
  it('names exactly the folders under app/(app)', () => {
    const folders = readdirSync(join(process.cwd(), 'app', '(app)'), { withFileTypes: true })
      .filter(d => d.isDirectory() && !d.name.startsWith('_') && !d.name.startsWith('('))
      .map(d => d.name)
      .sort()
    expect([...GP_APP_SEGMENTS].sort()).toEqual(folders)
  })

  it('matches whole segments only', () => {
    expect(isGpAppPath('/funds/abc/ledger')).toBe(true)
    expect(isGpAppPath('/lp-portal')).toBe(true)
    expect(isGpAppPath('/portal/overview')).toBe(false)
    expect(isGpAppPath('/fundsx')).toBe(false)
    expect(isGpAppPath('/onboarding')).toBe(false)
    expect(isGpAppPath('/')).toBe(false)
  })
})
