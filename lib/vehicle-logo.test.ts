import { describe, it, expect } from 'vitest'
import { pickDocumentLogo, safeLogo } from './vehicle-logo'

const FUND = 'data:image/png;base64,FUND'
const NORTHWIND = 'data:image/png;base64,NWH'
const logos = new Map([
  ['Northwind Holdings LP', NORTHWIND],
  ['Northwind Holdings II LP', NORTHWIND],
  ['Northwind Holdings Fund I', NORTHWIND], // an alias of Northwind Holdings LP
])

describe('pickDocumentLogo', () => {
  it("uses a vehicle's own logo on a document about that vehicle", () => {
    expect(pickDocumentLogo(FUND, ['Northwind Holdings LP'], logos)).toBe(NORTHWIND)
    expect(pickDocumentLogo(FUND, ['Northwind Holdings Fund I'], logos)).toBe(NORTHWIND)
  })

  it('falls back to the fund logo for a vehicle without one', () => {
    expect(pickDocumentLogo(FUND, ['Fund I'], logos)).toBe(FUND)
  })

  it('uses the vehicle logo across vehicles only when they all share it', () => {
    expect(pickDocumentLogo(FUND, ['Northwind Holdings LP', 'Northwind Holdings II LP', 'Northwind Holdings LP'], logos)).toBe(NORTHWIND)
    expect(pickDocumentLogo(FUND, ['Northwind Holdings LP', 'Fund I'], logos)).toBe(FUND)
  })

  it('never returns a remote URL, which headless Chrome cannot render', () => {
    expect(pickDocumentLogo('https://example.com/logo.png', ['Fund I'], logos)).toBeNull()
    expect(safeLogo('https://example.com/logo.png')).toBeNull()
  })

  it('uses the fund logo for a document with no vehicle', () => {
    expect(pickDocumentLogo(FUND, [], logos)).toBe(FUND)
  })
})
