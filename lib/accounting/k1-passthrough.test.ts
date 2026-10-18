import { describe, it, expect } from 'vitest'
import { bucketForSourceType, computeCapitalAccounts } from './capital-account'
import {
  allocateK1,
  incomeTotal,
  K1_BOX,
  K1_PASS_THROUGH_ONLY,
  type FundYearCharacter,
  type PartnerYearActivity,
} from './k1-allocation'
import {
  buildPassThroughDrafts,
  companyFromPassThroughRef,
  passThroughLines,
  passThroughSourceRef,
  passThroughSourceRefPrefix,
  withPassThroughCharacter,
  PASS_THROUGH_K1_CATEGORY,
  PASS_THROUGH_SLOTS,
  PASS_THROUGH_SLOT_LIST,
  PASS_THROUGH_SOURCE_TYPE,
  type DraftPosting,
  type PassThroughCapitalSide,
  type PassThroughDraft,
} from './k1-passthrough'
import { PASS_THROUGH_CHART, PASS_THROUGH_BASIS_SUBTYPE, passThroughBasisCode, DEFAULT_CHART, GP_ENTITY_CHART, MANAGEMENT_COMPANY_CHART, INDIVIDUAL_CHART } from './chart'
import { taxSourceRef } from './book-tax-run'
import type { ReceivedK1Amounts } from '@/lib/tax/received-k1-amounts'

// Invented figures throughout: Example Fund I holds Northwind Partners III, two partners on a
// 75/25 commitment split.
const PARTNERS: PassThroughCapitalSide = {
  mode: 'partners',
  weights: {
    income: [{ lpEntityId: 'lp-a', commitment: 750_000 }, { lpEntityId: 'lp-b', commitment: 250_000 }],
    gain: [{ lpEntityId: 'lp-a', commitment: 750_000 }, { lpEntityId: 'lp-b', commitment: 250_000 }],
    deduction: [{ lpEntityId: 'lp-a', commitment: 750_000 }, { lpEntityId: 'lp-b', commitment: 250_000 }],
  },
}

const K1: ReceivedK1Amounts = {
  ordinaryBusinessIncome: -2_000,
  interest: 1_000,
  ordinaryDividends: 4_000,
  qualifiedDividends: 3_000,
  shortTermGain: 500,
  longTermGain: 10_000,
  section1231Gain: 1_500,
  investmentInterest: 300,
  otherDeductions: 700,
  distributionsCash: 8_000,
  capitalEnding: 120_000,
}

const sum = (ps: DraftPosting[]) => Math.round(ps.reduce((s, p) => s + p.amount, 0) * 100) / 100
const on = (d: PassThroughDraft, kind: string, extra?: (p: DraftPosting) => boolean) =>
  d.postings.filter(p => p.account.kind === kind && (!extra || extra(p))).reduce((s, p) => s + p.amount, 0)

describe('passThroughLines', () => {
  it('splits 6a into the qualified part and the rest, so the two add back to 6a', () => {
    const lines = passThroughLines(K1)
    const div = lines.find(l => l.slot === 'dividends')!
    const qual = lines.find(l => l.slot === 'qualifiedDividends')!
    expect(div.reported).toBe(1_000)
    expect(qual.reported).toBe(3_000)
    expect(div.reported + qual.reported).toBe(K1.ordinaryDividends)
  })

  it('negates deductions for the basis effect and leaves income signed as printed', () => {
    const lines = passThroughLines(K1)
    expect(lines.find(l => l.slot === 'ordinary')!.basisEffect).toBe(-2_000)
    expect(lines.find(l => l.slot === 'investmentInterest')).toMatchObject({ reported: 300, basisEffect: -300 })
  })

  it('posts nothing for box 19 or Item L, and leaves zero boxes out', () => {
    const lines = passThroughLines({ distributionsCash: 5_000, capitalEnding: 1, interest: 0 })
    expect(lines).toEqual([])
  })
})

describe('buildPassThroughDrafts', () => {
  const r = buildPassThroughDrafts({ taxYear: 2024, holdingName: 'Northwind Partners III', amounts: K1, bookRealizedGain: 0, capital: PARTNERS })

  it('builds one balanced entry per roll-forward bucket, tagged with its source type', () => {
    expect(r.skipped).toBeUndefined()
    expect(r.drafts.map(d => d.bucket)).toEqual(['income', 'gain', 'deduction'])
    for (const d of r.drafts) {
      expect(sum(d.postings)).toBe(0)
      expect(d.sourceType).toBe(PASS_THROUGH_SOURCE_TYPE[d.bucket])
    }
  })

  it('credits each character account and debits the holding’s basis by the same amount', () => {
    const income = r.drafts.find(d => d.bucket === 'income')!
    // -2,000 + 1,000 + 1,000 + 3,000 = 3,000 of net income.
    expect(on(income, 'basis')).toBe(3_000)
    expect(on(income, 'slot', p => (p.account as any).slot === 'interest')).toBe(-1_000)
    expect(on(income, 'slot', p => (p.account as any).slot === 'ordinary')).toBe(2_000)
    const deduction = r.drafts.find(d => d.bucket === 'deduction')!
    expect(on(deduction, 'basis')).toBe(-1_000)
    expect(on(deduction, 'slot')).toBe(1_000)
  })

  it('puts the same amount on the partners’ capital through the bridge, by their weights', () => {
    const gain = r.drafts.find(d => d.bucket === 'gain')!
    expect(on(gain, 'bridge')).toBe(12_000)
    expect(on(gain, 'capital', p => p.lpEntityId === 'lp-a')).toBe(-9_000)
    expect(on(gain, 'capital', p => p.lpEntityId === 'lp-b')).toBe(-3_000)
  })

  it('moves basis by income less deductions', () => {
    expect(r.basisChange).toBe(3_000 + 12_000 - 1_000)
  })

  it('reverses the book gain on the holding’s distributions, with its capital side', () => {
    const withGain = buildPassThroughDrafts({ taxYear: 2024, holdingName: 'Northwind Partners III', amounts: K1, bookRealizedGain: 4_000, capital: PARTNERS })
    const reversal = withGain.drafts[withGain.drafts.length - 1]
    expect(reversal.sourceType).toBe('tax_adj_k1_gain')
    expect(on(reversal, 'bookRealized')).toBe(4_000)
    expect(on(reversal, 'basis')).toBe(-4_000)
    expect(on(reversal, 'capital', p => p.lpEntityId === 'lp-a')).toBe(3_000)
    expect(sum(reversal.postings)).toBe(0)
    expect(withGain.basisChange).toBe(r.basisChange - 4_000)
  })

  it('is deterministic — the same K-1 always builds the same entries, so a re-run replaces like for like', () => {
    const again = buildPassThroughDrafts({ taxYear: 2024, holdingName: 'Northwind Partners III', amounts: K1, bookRealizedGain: 0, capital: PARTNERS })
    expect(again).toEqual(r)
  })

  it('posts to the single owner on owner-equity books, and no capital side on retained-earnings books', () => {
    const owner = buildPassThroughDrafts({ taxYear: 2024, holdingName: 'Acme Fund', amounts: { interest: 100 }, bookRealizedGain: 0, capital: { mode: 'owner' } })
    expect(owner.drafts[0].postings.map(p => [p.account.kind, p.amount])).toEqual([['slot', -100], ['basis', 100], ['bridge', 100], ['owner', -100]])
    const none = buildPassThroughDrafts({ taxYear: 2024, holdingName: 'Acme Fund', amounts: { interest: 100 }, bookRealizedGain: 0, capital: { mode: 'none' } })
    expect(none.drafts[0].postings.map(p => p.account.kind)).toEqual(['slot', 'basis'])
  })

  it('refuses a holding when nobody participates in a bucket, rather than posting half an entry', () => {
    const res = buildPassThroughDrafts({
      taxYear: 2024, holdingName: 'Acme Fund', amounts: { longTermGain: 100 }, bookRealizedGain: 0,
      capital: { mode: 'partners', weights: { income: PARTNERS.mode === 'partners' ? PARTNERS.weights.income : [], gain: [], deduction: [] } },
    })
    expect(res.drafts).toEqual([])
    expect(res.skipped).toMatch(/No partner participates/)
  })
})

describe('source_ref', () => {
  it('is deterministic per (year, holding) and round-trips to the holding', () => {
    const ref = passThroughSourceRef(2024, 'company-1')
    expect(ref).toBe('tax-k1:2024:company-1')
    expect(companyFromPassThroughRef(ref, 2024)).toBe('company-1')
    expect(companyFromPassThroughRef(ref, 2025)).toBeNull()
    expect(companyFromPassThroughRef(null, 2024)).toBeNull()
  })

  it('never collides with the book-to-tax run’s own source_ref, so neither re-run voids the other', () => {
    expect(taxSourceRef(2024).startsWith(passThroughSourceRefPrefix(2024))).toBe(false)
    expect(passThroughSourceRef(2024, 'x').startsWith(taxSourceRef(2024))).toBe(false)
    // Nor is it a hand entry: the hand-entry check skips both prefixes and nothing else.
    expect(passThroughSourceRef(2024, 'x').startsWith('tax:')).toBe(false)
  })
})

describe('the roll-forward line of each pass-through entry', () => {
  it('lands income, gain and deductions on the lines the fund’s own items use', () => {
    expect(bucketForSourceType(PASS_THROUGH_SOURCE_TYPE.income)).toBe('operatingIncome')
    expect(bucketForSourceType(PASS_THROUGH_SOURCE_TYPE.gain)).toBe('realizedGains')
    expect(bucketForSourceType(PASS_THROUGH_SOURCE_TYPE.deduction)).toBe('expenses')
  })
})

describe('chart accounts', () => {
  it('has exactly one pass-through account per slot, plus the basis parent', () => {
    const slotSubtypes = PASS_THROUGH_SLOT_LIST.map(s => PASS_THROUGH_SLOTS[s].subtype).sort()
    const chartSubtypes = PASS_THROUGH_CHART.map(a => a.subtype!).filter(s => s !== PASS_THROUGH_BASIS_SUBTYPE).sort()
    expect(chartSubtypes).toEqual(slotSubtypes)
    for (const s of PASS_THROUGH_SLOT_LIST) {
      const acct = PASS_THROUGH_CHART.find(a => a.subtype === PASS_THROUGH_SLOTS[s].subtype)!
      expect(acct.type).toBe(PASS_THROUGH_SLOTS[s].bucket === 'deduction' ? 'expense' : 'income')
    }
  })

  it('uses codes no starter chart already uses, since any vehicle kind can hold a fund', () => {
    const used = new Set([...DEFAULT_CHART, ...GP_ENTITY_CHART, ...MANAGEMENT_COMPANY_CHART, ...INDIVIDUAL_CHART].map(a => a.code))
    expect(PASS_THROUGH_CHART.filter(a => used.has(a.code)).map(a => a.code)).toEqual([])
    expect(passThroughBasisCode('abcdef12-3456')).toBe('1700-abcdef12')
  })
})

describe('the fund’s own K-1 boxes', () => {
  it('maps every pass-through account to the box a preparer expects', () => {
    const boxOf = Object.fromEntries(PASS_THROUGH_SLOT_LIST.map(s => [s, K1_BOX[PASS_THROUGH_K1_CATEGORY[s]]]))
    expect(boxOf).toEqual({
      ordinary: '1', rentalRealEstate: '2', otherRental: '3', guaranteedPayments: '1', interest: '5',
      dividends: '6a', qualifiedDividends: '6a', royalties: '7', shortTermGain: '8', longTermGain: '9a',
      section1231Gain: '10', otherIncome: '11', section179: '12', investmentInterest: '13H', otherDeductions: '13',
    })
  })

  it('adds the qualified account to 6a and to 6b, and the rest of dividends to 6a only', () => {
    const base: FundYearCharacter = {
      interest: 100, ordinaryDividends: 200, qualifiedDividends: 50, shortTermGain: 0, longTermGain: 0,
      longTermGainWithinApiPeriod: 0, otherIncome: 0, deductions: 10,
    }
    const out = withPassThroughCharacter(base, { dividends: 1_000, qualifiedDividends: 3_000, interest: 1_000, otherDeductions: 700, section1231Gain: 1_500 })
    expect(out.ordinaryDividends).toBe(4_200)
    expect(out.qualifiedDividends).toBe(3_050)
    expect(out.interest).toBe(1_100)
    expect(out.deductions).toBe(710)
    expect(out.section1231Gain).toBe(1_500)
  })

  it('prints the pass-through-only boxes only when a lower-tier K-1 fills them', () => {
    expect(K1_PASS_THROUGH_ONLY.has('interest')).toBe(false)
    expect(K1_PASS_THROUGH_ONLY.has('section1231Gain')).toBe(true)
  })

  it('end to end: the posted entries put each partner’s share on the right box, and the K-1 ties to tax capital', () => {
    const built = buildPassThroughDrafts({ taxYear: 2024, holdingName: 'Northwind Partners III', amounts: K1, bookRealizedGain: 0, capital: PARTNERS })
    // The partners' capital postings, as k1-load reads them: per entry source_type.
    const capitalPostings = built.drafts.flatMap(d => d.postings
      .filter(p => p.account.kind === 'capital')
      .map(p => ({ lpEntityId: p.lpEntityId!, amount: p.amount, sourceType: d.sourceType, entryDate: '2024-12-31' })))
    const accounts = computeCapitalAccounts(capitalPostings, { start: '2024-01-01', end: '2024-12-31' })
    const partners: PartnerYearActivity[] = Array.from(accounts.entries()).map(([lpEntityId, a]) => ({
      lpEntityId, beginningCapital: a.beginning, contributions: a.contributions, distributions: Math.abs(a.distributions),
      operatingIncome: a.operatingIncome, realizedGains: a.realizedGains, expenses: Math.abs(a.managementFees) + Math.abs(a.expenses),
      carriedInterest: a.carriedInterest, endingCapital: a.ending,
    }))
    // The character accounts' movements, as k1-load reads them.
    const pt: Record<string, number> = {}
    for (const d of built.drafts) for (const p of d.postings) {
      if (p.account.kind !== 'slot') continue
      const slot = p.account.slot
      pt[slot] = (pt[slot] ?? 0) + (PASS_THROUGH_SLOTS[slot].bucket === 'deduction' ? p.amount : -p.amount)
    }
    const zero: FundYearCharacter = { interest: 0, ordinaryDividends: 0, qualifiedDividends: 0, shortTermGain: 0, longTermGain: 0, longTermGainWithinApiPeriod: 0, otherIncome: 0, deductions: 0 }
    const res = allocateK1({ fund: withPassThroughCharacter(zero, pt), partners })
    const a = res.partners.find(p => p.lpEntityId === 'lp-a')!
    expect(a.lines.interest).toBe(750)
    expect(a.lines.ordinaryDividends).toBe(3_000)
    expect(a.lines.qualifiedDividends).toBe(2_250)
    expect(a.lines.ordinaryBusinessIncome).toBe(-1_500)
    expect(a.lines.longTermGain).toBe(7_500)
    expect(a.lines.section1231Gain).toBe(1_125)
    expect(a.lines.investmentInterest).toBe(225)
    expect(a.lines.deductions).toBe(525)
    for (const p of res.partners) expect(p.tieOut.variance).toBe(0)
    expect(res.unallocated).toEqual({})
    // Net income on the K-1 is the basis the holding gained, split by commitment.
    expect(incomeTotal(a.lines)).toBe(0.75 * built.basisChange)
  })
})
