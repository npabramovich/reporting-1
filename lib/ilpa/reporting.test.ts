import { describe, it, expect } from 'vitest'
import {
  buildIlpaReporting, quarterBounds, reportingDates, reportingSheetRows, splitAcross,
  type ReportingCapitalPosting, type ReportingInputs, type ReportingPnlLine,
} from './reporting'
import { REPORTING_LINE, type ReportingLineKey } from './taxonomy'

// Two limited partners (A 60%, B 40%) and a carry recipient G in the GP class. Q2 2026.
const Q = '2026-06-30'
const cap = (lpEntityId: string, amount: number, sourceType: string, entryDate: string, entryId: string): ReportingCapitalPosting =>
  ({ lpEntityId, amount, sourceType, entryDate, entryId })
const pnl = (entryId: string, entryDate: string, amount: number, category: ReportingPnlLine['category'], bucket: ReportingPnlLine['bucket']): ReportingPnlLine =>
  ({ entryId, entryDate, amount, category, bucket, accountName: category })

function inputs(extra: Partial<ReportingInputs> = {}): ReportingInputs {
  const commitments = new Map([['A', 600_000], ['B', 400_000]])
  const d = reportingDates(Q)
  return {
    fund: { name: 'Example Fund I', vehicle: 'Example Fund I', currency: 'USD' },
    partner: { id: 'A', name: 'Acme' },
    quarterEnd: Q,
    closed: true,
    bundleSha256: null,
    classes: new Map([['G', 'gp']]),
    capital: [
      cap('A', -300_000, 'capital_call', '2026-01-15', 'call'),
      cap('B', -200_000, 'capital_call', '2026-01-15', 'call'),
      // Q1 fee, allocated when it posted.
      cap('A', 6_000, 'management_fee', '2026-03-31', 'alloc-fee'),
      cap('B', 4_000, 'management_fee', '2026-03-31', 'alloc-fee'),
      // Q2 expenses and the mark, allocated at the close.
      cap('A', 3_000, 'partnership_expense', '2026-06-30', 'close'),
      cap('B', 2_000, 'partnership_expense', '2026-06-30', 'close'),
      cap('A', -60_000, 'valuation', '2026-06-30', 'close'),
      cap('B', -40_000, 'valuation', '2026-06-30', 'close'),
      // Carry accrued on the mark.
      cap('A', 12_000, 'carried_interest', '2026-06-30', 'carry'),
      cap('B', 8_000, 'carried_interest', '2026-06-30', 'carry'),
      cap('G', -20_000, 'carried_interest', '2026-06-30', 'carry'),
    ],
    pnl: [
      pnl('fee', '2026-03-31', 12_500, 'mgmt_fee_gross', 'managementFees'),
      pnl('fee', '2026-03-31', -2_500, 'mgmt_fee_offset', 'managementFees'),
      pnl('exp', '2026-05-10', 3_000, 'ext_audit', 'expenses'),
      pnl('exp', '2026-05-10', 2_000, 'ext_legal', 'expenses'),
      pnl('mark', '2026-06-30', -100_000, 'net_unrealized_gain', 'unrealizedGains'),
    ],
    allocationOrigin: new Map([
      ['alloc-fee', { entryId: 'fee' }],
      ['close', { start: '2026-04-01', end: '2026-06-30' }],
    ]),
    carryRecipients: new Set(['G']),
    earnedShare: new Map([[d.beforeQuarter, 0], [d.beforeYear, 0], [Q, 0.25]]),
    commitments: new Map([[d.beforeQuarter, commitments], [d.beforeYear, commitments], [Q, commitments]]),
    portfolioFees: [{ date: '2026-05-01', kind: 'transaction', amount: 10_000, affiliatedAmount: 1_000, memo: null }],
    offsetShares: { transaction: 0.5 },
    organizationalExpenseCap: null,
    organizationalExpenses: [],
    escrow: [],
    notes: [],
    ...extra,
  }
}

const COL = { partner: 0, fund: 3, gp: 6 }
const WIN = { QTD: 0, YTD: 1, ITD: 2 }
const at = (r: ReturnType<typeof buildIlpaReporting>, key: ReportingLineKey, who: keyof typeof COL, w: keyof typeof WIN) =>
  r.values[key][COL[who] + WIN[w]]

describe('quarter dates', () => {
  it('opens the quarter and the year a calendar quarter end closes', () => {
    expect(quarterBounds('2026-06-30')).toEqual({ quarterStart: '2026-04-01', yearStart: '2026-01-01' })
    expect(quarterBounds('2026-12-31')).toEqual({ quarterStart: '2026-10-01', yearStart: '2026-01-01' })
    expect(reportingDates('2026-03-31')).toEqual({ beforeQuarter: '2025-12-31', beforeYear: '2025-12-31', quarterEnd: '2026-03-31' })
    expect(() => quarterBounds('2026-06-29')).toThrow()
  })
})

describe('splitAcross', () => {
  it('splits to the cent in proportion, the remainder on the largest part', () => {
    const parts = splitAcross(-100, new Map([['ext_audit', 1], ['ext_legal', 1], ['ext_admin', 1]]), 'ext_other')
    expect(parts.reduce((s, [, a]) => s + a, 0)).toBeCloseTo(-100, 10)
    expect(parts.map(([, a]) => a).sort()).toEqual([-33.34, -33.33, -33.33].sort())
  })

  it('falls back to one category when the weights cancel', () => {
    expect(splitAcross(50, new Map([['ext_audit', 10], ['ext_offset', -10]]), 'ext_other')).toEqual([['ext_other', 50]])
  })
})

describe('the partner statement', () => {
  const r = buildIlpaReporting(inputs())

  it('rolls the NAV from beginning to the capital on the books, in every column', () => {
    for (const t of r.ties) expect(t.difference, `${t.column.allocation} ${t.column.window}`).toBe(0)
    expect(at(r, 'beginning_nav', 'partner', 'QTD')).toBe(294_000)
    expect(at(r, 'beginning_nav', 'partner', 'ITD')).toBe(0)
    expect(at(r, 'contributions', 'partner', 'YTD')).toBe(300_000)
    expect(at(r, 'ending_nav', 'partner', 'QTD')).toBe(339_000)
  })

  it("splits an allocation by the P&L it came from: the source entry's, or the closed period's", () => {
    expect(at(r, 'mgmt_fee_gross', 'partner', 'YTD')).toBe(-7_500)
    expect(at(r, 'mgmt_fee_offset', 'partner', 'YTD')).toBe(1_500)
    expect(at(r, 'mgmt_fee_net', 'partner', 'YTD')).toBe(-6_000)
    expect(at(r, 'ext_audit', 'partner', 'QTD')).toBe(-1_800)
    expect(at(r, 'ext_legal', 'partner', 'QTD')).toBe(-1_200)
    expect(at(r, 'mgmt_fee_gross', 'partner', 'QTD')).toBe(0)
  })

  it("puts the carry accrual in the gains, earned in realized and accrued in unrealized", () => {
    expect(at(r, 'net_realized_gain', 'partner', 'QTD')).toBe(-3_000)
    expect(at(r, 'net_unrealized_gain', 'partner', 'QTD')).toBe(51_000)
    expect(at(r, 'carry_earned', 'partner', 'QTD')).toBe(-3_000)
    expect(at(r, 'carry_accrued', 'partner', 'QTD')).toBe(-9_000)
    expect(at(r, 'carry_ending', 'partner', 'QTD')).toBe(-12_000)
    expect(at(r, 'ending_nav_gross', 'partner', 'QTD')).toBe(351_000)
  })

  it('nets carry to nothing for the whole fund and credits the recipient in the GP column', () => {
    expect(at(r, 'carry_total', 'fund', 'QTD')).toBe(0)
    expect(at(r, 'total_gain', 'fund', 'QTD')).toBe(100_000)
    expect(at(r, 'carry_total', 'gp', 'QTD')).toBe(20_000)
    expect(at(r, 'ending_nav', 'gp', 'QTD')).toBe(20_000)
    expect(at(r, 'ending_nav_gross', 'gp', 'QTD')).toBe(0)
  })

  it('recognizes offsets from the fee register and rolls the unapplied balance', () => {
    expect(at(r, 'offset_transaction', 'fund', 'QTD')).toBe(5_000)
    expect(at(r, 'offset_transaction', 'partner', 'QTD')).toBe(3_000)
    expect(at(r, 'offsets_applied', 'partner', 'YTD')).toBe(1_500)
    expect(at(r, 'unapplied_beginning', 'partner', 'QTD')).toBe(-1_500)
    expect(at(r, 'unapplied_ending', 'partner', 'QTD')).toBe(1_500)
    expect(at(r, 'unapplied_ending', 'partner', 'YTD')).toBe(1_500)
    expect(r.offsetPercent.offset_transaction).toBe(0.5)
  })

  it('reconciles the commitment', () => {
    expect(at(r, 'total_commitment', 'partner', 'QTD')).toBe(600_000)
    expect(at(r, 'beginning_unfunded', 'partner', 'QTD')).toBe(300_000)
    expect(at(r, 'beginning_unfunded', 'partner', 'YTD')).toBe(600_000)
    expect(at(r, 'unfunded_contributions', 'partner', 'YTD')).toBe(-300_000)
    expect(at(r, 'ending_unfunded', 'partner', 'ITD')).toBe(300_000)
    expect(at(r, 'ending_unfunded', 'fund', 'QTD')).toBe(500_000)
  })

  it('states portfolio-company fees at the partner, fund and affiliated levels', () => {
    expect(at(r, 'pc_transaction', 'partner', 'QTD')).toBe(6_000)
    expect(at(r, 'pc_transaction', 'fund', 'QTD')).toBe(10_000)
    expect(at(r, 'pc_transaction', 'gp', 'QTD')).toBe(1_000)
    expect(at(r, 'pc_total', 'fund', 'YTD')).toBe(10_000)
  })

  it('credits ILPA and marks an open quarter as a draft', () => {
    expect(r.status).toBe('final')
    expect(r.footnotes.at(-1)).toMatch(/Institutional Limited Partners Association/)
    const draft = buildIlpaReporting(inputs({ closed: false }))
    expect(draft.status).toBe('draft')
    expect(draft.footnotes[0]).toMatch(/^DRAFT/)
  })
})

describe('carry paid', () => {
  const base = inputs()
  const r = buildIlpaReporting(inputs({ capital: [...base.capital, cap('G', 5_000, 'carry_distribution', '2026-06-30', 'paid')] }))

  it("is the recipient's distribution, and the limited partners' share of it reduces their carry balance", () => {
    expect(at(r, 'distributions', 'gp', 'QTD')).toBe(-5_000)
    expect(at(r, 'carry_paid', 'gp', 'QTD')).toBe(-5_000)
    expect(at(r, 'carry_paid', 'partner', 'QTD')).toBe(3_000)
    expect(at(r, 'carry_ending', 'partner', 'QTD')).toBe(-9_000)
    expect(at(r, 'carry_paid', 'fund', 'QTD')).toBe(0)
    for (const t of r.ties) expect(t.difference).toBe(0)
  })
})

describe('the sheet', () => {
  it('carries every non-heading line once per section with nine figures', () => {
    const rows = reportingSheetRows(buildIlpaReporting(inputs()))
    const labelled = rows.filter(row => typeof row[0] === 'string' && row.length >= 10)
    const audit = labelled.find(row => row[0] === REPORTING_LINE.ext_audit.label)!
    expect(audit.slice(1, 10)).toHaveLength(9)
    expect(rows.find(row => row[0] === REPORTING_LINE.offset_transaction.label)?.[10]).toBe(0.5)
    expect(rows.some(row => row[0] === "Acme's Allocation of Total Fund" || row[1] === "Acme's Allocation of Total Fund")).toBe(true)
  })
})
