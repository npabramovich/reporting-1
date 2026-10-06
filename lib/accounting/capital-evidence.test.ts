import { describe, expect, it } from 'vitest'
import { resolveCapitalEvidence } from './capital-evidence'
import { reportingIrr } from './reporting-irr'
import { computeCapitalAccounts } from './capital-account'
import { resolveDatedCommitments } from './terms'

const position = { lpEntityId: 'lp', asOfDate: '2025-03-31', commitment: 200, calledCapital: 100, distributions: 0, nav: 120, irr: 0.12 }
const ledger = [
  { lpEntityId: 'lp', entryDate: '2025-01-01', sourceType: 'contribution', amount: -100 },
  { lpEntityId: 'lp', entryDate: '2025-03-31', sourceType: 'valuation', amount: -20 },
]

describe('capital evidence resolution', () => {
  it('keeps reported balances when a partial ledger exists, without adding the two', () => {
    const r = resolveCapitalEvidence(ledger.slice(0, 1), [position], '2025-04-30')
    expect(computeCapitalAccounts(r.postings).get('lp')?.ending).toBe(120)
    expect(r.evidenceByLp.get('lp')).toMatchObject({ basis: 'reported', conflict: true, asOf: '2025-03-31' })
  })
  it('ignores a chart and unrelated activity when selecting capital information', () => {
    expect(resolveCapitalEvidence([], [position]).evidenceByLp.get('lp')?.basis).toBe('reported')
    const r = resolveCapitalEvidence([{ ...ledger[0], lpEntityId: 'other' }], [position])
    expect(r.evidenceByLp.get('lp')?.basis).toBe('reported')
    expect(r.evidenceByLp.get('other')?.basis).toBe('ledger')
  })
  it('uses reconciled books through the reviewed date and never doubles opening records', () => {
    const r = resolveCapitalEvidence(ledger, [position], '2025-03-31', '2025-03-31')
    expect(r.postings).toEqual(ledger)
    expect(computeCapitalAccounts(r.postings).get('lp')?.ending).toBe(120)
  })
  it('retains the observation date if later activity has not been reviewed', () => {
    const r = resolveCapitalEvidence([...ledger, { ...ledger[1], entryDate: '2025-04-20', amount: 5 }], [position], '2025-04-30', '2025-03-31')
    expect(r.evidenceByLp.get('lp')).toMatchObject({ basis: 'reported', asOf: '2025-03-31' })
  })
  it('does not turn missing fields into evidence of zero', () => {
    const r = resolveCapitalEvidence([], [{ ...position, nav: null }])
    expect(r.evidenceByLp.get('lp')?.missing).toEqual(['nav'])
    expect(r.postings).toEqual([])
  })
  it('keeps a confirmed zero NAV', () => {
    const r = resolveCapitalEvidence([], [{ ...position, nav: 0 }])
    expect(r.evidenceByLp.get('lp')?.missing).toEqual([])
    expect(computeCapitalAccounts(r.postings).get('lp')?.ending).toBe(0)
  })
  it('uses reported IRR but never derives it from statement movement dates', () => {
    const r = resolveCapitalEvidence([], [position])
    expect(reportingIrr(r.postings, 120, r.evidenceByLp.get('lp'))).toBe(0.12)
    const without = resolveCapitalEvidence([], [{ ...position, irr: null }])
    expect(reportingIrr(without.postings, 120, without.evidenceByLp.get('lp'))).toBeNull()
  })
  it('excludes future observations and journal entries', () => {
    const r = resolveCapitalEvidence(ledger, [position], '2024-12-31')
    expect(r.postings).toEqual([])
    expect(r.evidenceByLp.size).toBe(0)
  })
})

describe('dated commitments', () => {
  const owners = [{ lpEntityId: 'lp', commitment: 999 }, { lpEntityId: 'other', commitment: 50 }]
  it('keeps a zero event balance and does not erase an unrelated partner', () => {
    const events = [{ lpEntityId: 'lp', effectiveDate: '2025-01-01', amount: 100, kind: 'initial' }, { lpEntityId: 'lp', effectiveDate: '2025-02-01', amount: -100, kind: 'transfer' }]
    expect(resolveDatedCommitments(events, owners, [])).toEqual(new Map([['other', 50], ['lp', 0]]))
  })
  it('does not pull a future commitment back into historical reports', () => {
    const events = [{ lpEntityId: 'lp', effectiveDate: '2025-06-01', amount: 999, kind: 'initial' }]
    expect(resolveDatedCommitments(events, owners, [], '2025-01-01').has('lp')).toBe(false)
  })
  it('moves a transfer between partners without changing the fund total', () => {
    // The real kinds terms.ts writes for a transfer, as a signed pair. The resolver sums amounts
    // and ignores the label, so both legs land on their own partner and the total is preserved —
    // an aggregate that reconciles to the same population is the invariant here.
    const events = [
      { lpEntityId: 'lp', effectiveDate: '2025-01-01', amount: 100, kind: 'initial' },
      { lpEntityId: 'other', effectiveDate: '2025-01-01', amount: 50, kind: 'initial' },
      { lpEntityId: 'lp', effectiveDate: '2025-06-01', amount: -40, kind: 'transfer_out' },
      { lpEntityId: 'other', effectiveDate: '2025-06-01', amount: 40, kind: 'transfer_in' },
    ]
    const before = resolveDatedCommitments(events, owners, [], '2025-05-31')
    const after = resolveDatedCommitments(events, owners, [], '2025-12-31')
    expect([before.get('lp'), before.get('other')]).toEqual([100, 50])
    expect([after.get('lp'), after.get('other')]).toEqual([60, 90])
    const total = (m: Map<string, number>) => Array.from(m.values()).reduce((sum, value) => sum + value, 0)
    expect(total(after)).toBe(total(before))
  })
  it('applies later event deltas to the statement anchor exactly once', () => {
    const events = [{ lpEntityId: 'lp', effectiveDate: '2025-03-31', amount: 200, kind: 'initial' }, { lpEntityId: 'lp', effectiveDate: '2025-04-01', amount: -50, kind: 'transfer' }]
    expect(resolveDatedCommitments(events, owners, [position]).get('lp')).toBe(150)
    expect(resolveDatedCommitments(events, owners, [position], '2025-03-31').get('lp')).toBe(200)
  })
})


describe('reviewed coverage', () => {
  const later = [...ledger, { ...ledger[1], entryDate: '2025-05-20', amount: 5 }]
  it('retains reported balances when there is a gap between closed periods', () => {
    const result = resolveCapitalEvidence(later, [position], '2025-05-31', '2025-05-31', [
      { start: '2025-03-01', end: '2025-03-31' }, { start: '2025-05-01', end: '2025-05-31' },
    ])
    expect(result.evidenceByLp.get('lp')).toMatchObject({ basis: 'reported', values: { nav: 120 } })
  })
  it('rolls matching balances through contiguous reviewed activity exactly once', () => {
    const result = resolveCapitalEvidence(later, [position], '2025-05-31', null, [
      { start: '2025-04-01', end: '2025-05-31' }, { start: '2025-03-01', end: '2025-03-31' },
    ])
    expect(result.evidenceByLp.get('lp')).toMatchObject({ basis: 'ledger', values: { nav: 115 } })
  })
  it('reports known-field differences even if another statement field is missing', () => {
    const result = resolveCapitalEvidence(ledger, [{ ...position, calledCapital: 90, nav: null }])
    expect(result.evidenceByLp.get('lp')).toMatchObject({ conflict: true, missing: ['nav'], values: { nav: null } })
  })
})
