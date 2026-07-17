import type { Metadata } from 'next'
import { requireAccountingAccess } from './guard'
import { FundOverview } from './fund-overview'

export const metadata: Metadata = { title: 'Funds' }

/**
 * The fund overview — the landing page for the whole accounting section.
 *
 * Performance per vehicle, derived from the ledger. The subpages (capital accounts,
 * statements, journal, …) are reached from the sidebar subnav, so this page does NOT repeat
 * them as a grid of link cards — that was duplicative — and the per-vehicle rows don't link
 * either. See lib/accounting/fund-economics.ts for why "net to LP" is exact here rather than
 * estimated.
 *
 * FundOverview owns its own empty state: with no vehicle carrying any capital, it explains how
 * to onboard one rather than showing a blank table. (Per-vehicle setup lives on the Admin
 * page, /funds/status.)
 */
export default async function AccountingPage() {
  await requireAccountingAccess()

  return (
    <div className="pt-3 pb-8 w-full">
      <div className="mb-6 space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Funds</h1>
        <p className="text-sm text-muted-foreground">
          Performance per vehicle, derived from fund accounting or LP capital accounts.
        </p>
      </div>

      <FundOverview />
    </div>
  )
}
