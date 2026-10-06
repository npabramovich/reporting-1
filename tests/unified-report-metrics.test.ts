import { describe, expect, it } from 'vitest'
import { computeRow, computeTotals } from '@/lib/lp-report-pdf'
import { overviewFromLive } from '@/lib/lp-overview'

describe('missing capital in exported and portal reports', () => {
  it('does not replace a missing NAV with zero in rows, totals, or ratios', () => {
    const row = computeRow({ commitment: 100, paid_in_capital: 40, called_capital: 50, distributions: 0, nav: null, total_value: null } as any)
    expect(row).toMatchObject({ paidInCapital: 40, nav: null, totalValue: null, tvpi: null })
    expect(computeTotals([row])).toMatchObject({ nav: null, totalValue: null, tvpi: null, dpi: 0 })
    const portal = overviewFromLive([{ portfolio_group: 'Fund I', commitment: 100, paid_in_capital: 40, distributions: 0, nav: null }])
    expect(portal?.totals).toMatchObject({ nav: null, tvpi: null, dpi: 0 })
  })
  it('retains an explicit paid-in zero rather than substituting a different field', () => {
    expect(computeRow({ commitment: 100, paid_in_capital: 0, called_capital: 50, distributions: 0, nav: 0, total_value: 0 } as any)).toMatchObject({ paidInCapital: 0, nav: 0, totalValue: 0, tvpi: null })
  })
})
