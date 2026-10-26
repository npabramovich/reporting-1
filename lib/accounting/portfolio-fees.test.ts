import { describe, expect, it } from 'vitest'
import { parsePortfolioFeeInput } from './portfolio-fees'

describe('parsePortfolioFeeInput', () => {
  const company = '00000000-0000-4000-8000-000000000001'

  it('keeps a fee, rounded to cents, with an optional company and memo', () => {
    expect(parsePortfolioFeeInput({ date: '2027-03-31', kind: 'monitoring', amount: '25000.004', companyId: company, memo: '  Q1 board fee ' })).toEqual({
      ok: true, value: { date: '2027-03-31', kind: 'monitoring', amount: 25_000, affiliatedAmount: null, companyId: company, memo: 'Q1 board fee' },
    })
    expect(parsePortfolioFeeInput({ date: '2027-03-31', kind: 'other', amount: 100, companyId: '', memo: '' })).toEqual({
      ok: true, value: { date: '2027-03-31', kind: 'other', amount: 100, affiliatedAmount: null, companyId: null, memo: null },
    })
  })

  it("takes every kind on ILPA's list and the affiliated positions' share", () => {
    expect(parsePortfolioFeeInput({ date: '2027-03-31', kind: 'capital_markets', amount: 1_000, affiliatedAmount: '250' })).toMatchObject({
      ok: true, value: { kind: 'capital_markets', amount: 1_000, affiliatedAmount: 250 },
    })
    expect(parsePortfolioFeeInput({ date: '2027-03-31', kind: 'reimbursement', amount: 80 })).toMatchObject({ ok: true })
  })

  it('refuses what the form refuses', () => {
    const fee = { date: '2027-03-31', kind: 'transaction', amount: 100 }
    expect(parsePortfolioFeeInput({ ...fee, date: '31/03/2027' })).toEqual({ error: 'The fee needs a date (YYYY-MM-DD).' })
    expect(parsePortfolioFeeInput({ ...fee, kind: 'closing' })).toEqual({ error: expect.stringMatching(/^The fee's kind is one of advisory, broken_deal, /) })
    expect(parsePortfolioFeeInput({ ...fee, affiliatedAmount: -1 })).toEqual({ error: "The affiliated positions' share must be zero or more." })
    expect(parsePortfolioFeeInput({ ...fee, amount: 0 })).toEqual({ error: 'The fee needs an amount above zero.' })
    expect(parsePortfolioFeeInput({ ...fee, companyId: 'acme' })).toEqual({ error: 'The company is not one of the fund\'s.' })
  })
})
