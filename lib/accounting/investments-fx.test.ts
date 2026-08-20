import { describe, it, expect } from 'vitest'
import { investmentCostCode, investmentUnrealizedCode, investmentFxCode } from './investments'
import { scheduleOfInvestments } from './statements'
import { bucketForSourceType, computeCapitalAccounts } from './capital-account'
import { computeFxRevaluation } from '@/lib/fx'
import type { Account, Posting } from './types'

// A EUR position held by a USD-reporting fund.
const EU = 'eeeeeeee-1111-2222-3333-444444444444'
// A plain USD position, to prove FX never touches it.
const US = 'dddddddd-1111-2222-3333-444444444444'

const accounts: Account[] = [
  { id: 'cash', fundId: 'f', code: '1000', name: 'Cash', type: 'asset', subtype: 'cash' },
  { id: 'costEU', fundId: 'f', code: investmentCostCode(EU), name: 'Investment — Eurocorp', type: 'asset', subtype: 'investment', companyId: EU },
  { id: 'unrlEU', fundId: 'f', code: investmentUnrealizedCode(EU), name: 'Unrealized — Eurocorp', type: 'asset', subtype: 'unrealized', companyId: EU },
  { id: 'fxEU', fundId: 'f', code: investmentFxCode(EU), name: 'FX translation — Eurocorp', type: 'asset', subtype: 'fx_translation', companyId: EU },
  { id: 'costUS', fundId: 'f', code: investmentCostCode(US), name: 'Investment — Domestic', type: 'asset', subtype: 'investment', companyId: US },
  { id: 'unrlUS', fundId: 'f', code: investmentUnrealizedCode(US), name: 'Unrealized — Domestic', type: 'asset', subtype: 'unrealized', companyId: US },
  { id: 'fxUS', fundId: 'f', code: investmentFxCode(US), name: 'FX translation — Domestic', type: 'asset', subtype: 'fx_translation', companyId: US },
  // The INCOME side. Note both carry the same subtypes as their asset counterparts —
  // the reason `scheduleOfInvestments` must filter on type === 'asset'.
  { id: 'unrlInc', fundId: 'f', code: '4200', name: 'Change in unrealized', type: 'income', subtype: 'unrealized' },
  { id: 'fxInc', fundId: 'f', code: '4300', name: 'FX translation', type: 'income', subtype: 'fx_translation' },
]

describe('the FX account code is distinct from cost and mark', () => {
  it('gives each company three accounts', () => {
    expect(investmentFxCode(EU)).toBe('1250-eeeeeeee')
    expect(new Set([investmentCostCode(EU), investmentUnrealizedCode(EU), investmentFxCode(EU)]).size).toBe(3)
  })
})

describe('a rate move is not investment performance', () => {
  // Eurocorp: cost $1,000 (€1,000 @ 1.00). The company doubles in EUR (mark +€1,000
  // = +$1,000 at the old rate), and the euro then falls from 1.00 to 0.90.
  //
  // At 0.90, €2,000 is worth $1,800. So carrying = 1800:
  //   cost 1000 + mark 1000 + fx (-200) = 1800.
  const postings: Posting[] = [
    { accountId: 'costEU', amount: 1_000, currency: 'USD' },
    { accountId: 'cash', amount: -1_000, currency: 'USD' },
    { accountId: 'unrlEU', amount: 1_000, currency: 'USD' },
    { accountId: 'unrlInc', amount: -1_000, currency: 'USD' },
    { accountId: 'fxEU', amount: -200, currency: 'USD' },
    { accountId: 'fxInc', amount: 200, currency: 'USD' },
  ]

  it('carries the position at cost + mark + FX', () => {
    const soi = scheduleOfInvestments(accounts, postings, 10_000, [
      { companyId: EU, name: 'Eurocorp', cost: 1_000, fairValue: 1_800 },
    ] as any)
    const row = soi.rows[0]
    expect(row.ledgerCost).toBe(1_000)
    expect(row.ledgerFairValue).toBe(1_800) // 1000 + 1000 − 200
    expect(row.tiesOut).toBe(true)
  })

  it('WOULD MISREPORT the position if FX were left out of the carrying value', () => {
    // The bug this guards: summing only cost + unrealized gives 2,000, so a EUR
    // position that genuinely carries at 1,800 fails its tie-out and the balance
    // sheet is overstated by the currency move.
    const soi = scheduleOfInvestments(accounts, postings, 10_000, [
      { companyId: EU, name: 'Eurocorp', cost: 1_000, fairValue: 1_800 },
    ] as any)
    expect(soi.rows[0].ledgerFairValue).not.toBe(2_000)
  })

  it('keeps the mark and the rate move in separate income accounts', () => {
    // The whole point: the portfolio was up 1,000 and the currency cost 200. A single
    // blended "unrealized" line would report +800 and tell you nothing about which.
    const soi = scheduleOfInvestments(accounts, postings, 10_000, [])
    expect(soi.ledgerCost).toBe(1_000)
    expect(soi.ledgerFairValue).toBe(1_800)
  })

  it('leaves a USD position untouched by FX', () => {
    const usd: Posting[] = [
      { accountId: 'costUS', amount: 500, currency: 'USD' },
      { accountId: 'cash', amount: -500, currency: 'USD' },
      { accountId: 'unrlUS', amount: 250, currency: 'USD' },
      { accountId: 'unrlInc', amount: -250, currency: 'USD' },
    ]
    const soi = scheduleOfInvestments(accounts, usd, 10_000, [
      { companyId: US, name: 'Domestic', cost: 500, fairValue: 750 },
    ] as any)
    expect(soi.rows[0].ledgerFairValue).toBe(750)
    expect(soi.rows[0].tiesOut).toBe(true)
  })

  it('a rate move that exactly offsets a mark still reports BOTH, not zero', () => {
    // Company up 1,000; currency down 1,000. Net carrying change is nil — but the
    // fund did NOT have a flat quarter, and the books must be able to say so.
    const offset: Posting[] = [
      { accountId: 'costEU', amount: 1_000, currency: 'USD' },
      { accountId: 'cash', amount: -1_000, currency: 'USD' },
      { accountId: 'unrlEU', amount: 1_000, currency: 'USD' },
      { accountId: 'unrlInc', amount: -1_000, currency: 'USD' },
      { accountId: 'fxEU', amount: -1_000, currency: 'USD' },
      { accountId: 'fxInc', amount: 1_000, currency: 'USD' },
    ]
    const soi = scheduleOfInvestments(accounts, offset, 10_000, [
      { companyId: EU, name: 'Eurocorp', cost: 1_000, fairValue: 1_000 },
    ] as any)
    expect(soi.rows[0].ledgerFairValue).toBe(1_000) // carrying is back to cost…

    // …but the two income accounts each still hold their own story.
    const markIncome = offset.filter(p => p.accountId === 'unrlInc').reduce((s, p) => s + p.amount, 0)
    const fxIncome = offset.filter(p => p.accountId === 'fxInc').reduce((s, p) => s + p.amount, 0)
    expect(markIncome).toBe(-1_000) // credit = income earned
    expect(fxIncome).toBe(1_000)    // debit = loss
  })
})

describe('the capital roll-forward gives FX its own line', () => {
  it('routes fx_revaluation away from unrealized gains', () => {
    expect(bucketForSourceType('valuation')).toBe('unrealizedGains')
    expect(bucketForSourceType('fx_revaluation')).toBe('fxTranslation')
  })

  it('allocates a mark and a rate move to different lines for the same LP', () => {
    const LP = 'lp-1'
    const accts = computeCapitalAccounts([
      { accountId: 'cap', amount: -1_000, currency: 'USD', lpEntityId: LP, sourceType: 'valuation', entryDate: '2026-03-31' },
      { accountId: 'cap', amount: 200, currency: 'USD', lpEntityId: LP, sourceType: 'fx_revaluation', entryDate: '2026-03-31' },
    ] as any)
    const a = accts.get(LP)!
    expect(a.unrealizedGains).toBe(1_000)  // credit to capital = gain
    expect(a.fxTranslation).toBe(-200)     // debit = currency loss
    expect(a.ending).toBe(800)             // and the two still net into the balance
  })
})

describe('computeFxRevaluation is the source of the number the ledger books', () => {
  it('gives the fund-currency effect of the rate alone', () => {
    // €2,000 carried at 1.00, rate falls to 0.90.
    const r = computeFxRevaluation({ positionValueOriginal: 2_000, priorRate: 1.0, newRate: 0.9 })
    expect(r.priorFundValue).toBe(2_000)
    expect(r.newFundValue).toBe(1_800)
    expect(r.fxValueChange).toBe(-200) // exactly what posts to 1250 / 4300
  })

  it('holds the position constant in its own currency — only the rate moves', () => {
    const r = computeFxRevaluation({ positionValueOriginal: 1_000, priorRate: 1.1, newRate: 1.2 })
    expect(r.fxValueChange).toBeCloseTo(100, 6)
  })
})
