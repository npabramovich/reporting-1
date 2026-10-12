import { describe, it, expect } from 'vitest'
import { buildStatementHtml, NET_PNL_LABEL, type StatementPdfData } from './lp-statement-pdf'
import { emptyAccount, type CapitalAccount } from './capital-account'

// One Northwind Holdings LP partner's books, inception to date (capital_accounts, Oct 2026).
const itd: CapitalAccount = {
  ...emptyAccount(),
  contributions: 90000, managementFees: -10000, expenses: -5200.00,
  operatingIncome: 1800.0, realizedGains: 134.3, ending: 77000.00,
}

function data(over: Partial<StatementPdfData> = {}): StatementPdfData {
  return {
    fundName: 'Ashgrove', fundLogo: null, fundAddress: null, currency: 'USD',
    vehicle: 'Northwind Holdings LP', partnerName: 'Jordan Avery',
    period: { label: 'Inception to date', start: null, end: null } as any,
    row: { commitment: 100000, called: 90000, funded: 90000, outstanding: 10000, receivable: 0, ending: 77000.00 },
    periodRollForward: itd, rollForward: itd, transactions: [], ownership: 0.02,
    ...over,
  }
}

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')

describe('buildStatementHtml', () => {
  it('shows beginning, management fees, net profit or loss, ending capital and the commitment', () => {
    const t = text(buildStatementHtml(data()))
    expect(t).toContain('Beginning capital')
    expect(t).toContain('Management fees ($10,000.00)')
    // -10000 - 5200.00 + 1800.00 + 134.30
    expect(t).toContain(`${NET_PNL_LABEL} ($13,000.00)`)
    expect(t).toContain('Ending capital $77,000.00')
    expect(t).toContain('Commitment $100,000.00')
  })

  it('keeps the rows outside the profit and loss block summing to ending capital', () => {
    // beginning + contributions + net P&L = ending; the components are indented under the subtotal.
    expect(0 + 90000 - 13000.00).toBeCloseTo(itd.ending, 2)
    const html = buildStatementHtml(data())
    expect(html.indexOf('Contributions')).toBeLessThan(html.indexOf('Management fees'))
    expect(html.indexOf('Net realized gain')).toBeLessThan(html.indexOf(NET_PNL_LABEL))
    expect(html.indexOf(NET_PNL_LABEL)).toBeLessThan(html.indexOf('Ending capital'))
  })

  it('leaves the subtotal out when nothing in the period is profit or loss', () => {
    const flat = { ...emptyAccount(), contributions: 5000, ending: 5000 }
    expect(buildStatementHtml(data({ periodRollForward: flat, rollForward: flat }))).not.toContain(NET_PNL_LABEL)
  })

  it("puts the vehicle's logo in the header when one is passed", () => {
    expect(buildStatementHtml(data({ fundLogo: 'data:image/png;base64,NWH' }))).toContain('src="data:image/png;base64,NWH"')
  })
})
