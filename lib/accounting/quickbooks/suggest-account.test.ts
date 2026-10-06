import { describe, expect, it } from 'vitest'
import { suggestAccount } from './suggest-account'

describe('new QuickBooks account suggestions', () => {
  it('separates accumulated amortization from expense', () => {
    expect(suggestAccount('Accumulated Amortization of Other Assets', [])).toMatchObject({ code: '1700', type: 'asset' })
    expect(suggestAccount('Amortization', [])).toMatchObject({ code: '5800', type: 'expense' })
  })

  it('preserves the full source name and chooses an unused number', () => {
    expect(suggestAccount('Office expenses:Software & apps', [{ code: '5300' }, { code: '5300.1' }]))
      .toMatchObject({ code: '5300.2', name: 'Office expenses:Software & apps', type: 'expense', subtype: 'technology' })
  })
})
