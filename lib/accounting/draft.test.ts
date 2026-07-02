import { describe, it, expect } from 'vitest'
import { parseDraftedEntry, resolveDraftedEntry, buildDraftPrompt } from './draft'
import { isBalanced } from './ledger'
import type { Account } from './types'

const accounts: Account[] = [
  { id: 'cash-id', fundId: 'f', code: '1000', name: 'Cash', type: 'asset' },
  { id: 'lpcap-id', fundId: 'f', code: '3100', name: 'LP Capital', type: 'equity' },
]

describe('buildDraftPrompt', () => {
  it('lists the chart and the JSON contract', () => {
    const { system, content } = buildDraftPrompt(accounts, 'Capital call notice…')
    expect(system).toContain('1000  Cash  (asset)')
    expect(system).toContain('debits are POSITIVE')
    expect(content).toBe('Capital call notice…')
  })
})

describe('parseDraftedEntry', () => {
  it('parses plain JSON', () => {
    const d = parseDraftedEntry('{"entryDate":"2026-06-30","sourceType":"capital_call","postings":[{"accountCode":"1000","amount":100000},{"accountCode":"3100","amount":-100000}]}')
    expect(d.entryDate).toBe('2026-06-30')
    expect(d.postings).toHaveLength(2)
  })

  it('tolerates code fences and surrounding prose', () => {
    const d = parseDraftedEntry('Here is the entry:\n```json\n{"entryDate":"2026-06-30","postings":[{"accountCode":"1000","amount":50},{"accountCode":"3100","amount":-50}]}\n```\nDone.')
    expect(d.postings[0].accountCode).toBe('1000')
  })

  it('throws when there is no JSON or no postings', () => {
    expect(() => parseDraftedEntry('no json here')).toThrow()
    expect(() => parseDraftedEntry('{"entryDate":"x","postings":[]}')).toThrow(/no postings/i)
  })
})

describe('resolveDraftedEntry', () => {
  const codes = new Map([['1000', 'cash-id'], ['3100', 'lpcap-id']])
  const names = new Map<string, string>()

  it('maps codes to account ids and reports balance', () => {
    const drafted = parseDraftedEntry('{"entryDate":"2026-06-30","postings":[{"accountCode":"1000","amount":100000},{"accountCode":"3100","amount":-100000}]}')
    const { entry, unknownCodes } = resolveDraftedEntry(drafted, 'f', codes, names)
    expect(unknownCodes).toEqual([])
    expect(entry.postings[0].accountId).toBe('cash-id')
    expect(isBalanced(entry)).toBe(true)
  })

  it('flags unknown account codes instead of dropping them', () => {
    const drafted = parseDraftedEntry('{"entryDate":"2026-06-30","postings":[{"accountCode":"9999","amount":100000},{"accountCode":"3100","amount":-100000}]}')
    const { unknownCodes } = resolveDraftedEntry(drafted, 'f', codes, names)
    expect(unknownCodes).toEqual(['9999'])
  })
})
