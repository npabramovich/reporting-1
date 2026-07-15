import { ogMetadata } from '@/lib/og-metadata'
import { Briefcase } from 'lucide-react'
import { ExplainerContent } from '../explainer-content'

export const metadata = ogMetadata({
  title: 'Funds',
  description: 'Fund-level performance per vehicle — committed, called, distributed, NAV, DPI, RVPI, TVPI, and IRR — derived from the ledger, plus the double-entry accounting behind it.',
})

export default function FundsExplainerPage() {
  return (
    <ExplainerContent
      title="Funds"
      icon={Briefcase}
      screenshotSrc="/screenshots/funds.png"
      screenshotLabel="Funds"
    >
      <p className="text-muted-foreground">
        The Funds section is your fund accounting — an optional double-entry ledger per vehicle, off
        by default. Its landing page is a fund overview: performance per vehicle — committed, paid-in,
        uncalled, distributed, NAV, DPI, RVPI, TVPI, and IRR — <strong>derived from the ledger</strong>,
        not typed in. Toggle between net-to-LP and whole-fund, and view it as of any date.
      </p>
      <p className="text-muted-foreground">
        These numbers are exact rather than estimated. Because a period close accrues carried interest
        into each partner&apos;s capital account, an LP&apos;s account is already net of the GP&apos;s
        share — so &ldquo;net to LP&rdquo; is the LP-class partners&apos; own accounts, with nothing to
        approximate. (This replaces an earlier version that computed metrics from hand-typed cash flows
        with an estimated-carry haircut.)
      </p>
      <p className="text-muted-foreground">
        Behind the overview sit the accounting workspaces: a chart of accounts and journal, a bank feed
        you categorize and post, capital calls booked against a receivable, a monthly close that allocates
        income and expenses to each partner (accruing note interest and carried interest), and full
        financial statements plus a schedule of investments that tie to the books.
      </p>
      <p className="text-muted-foreground">
        LP capital accounts themselves live in the <strong>LPs</strong> section — a ledgered vehicle
        feeds the same capital accounts and live LP report as a vehicle you simply track by pasting
        statements. Fund accounting just produces them from real books, with more detail and lines behind
        each figure.
      </p>
    </ExplainerContent>
  )
}
