import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { vehicleNameById } from '@/lib/accounting/vehicle-id'
import { requireAccountingAccess } from '../guard'
import { AccountingBody } from '@/components/accounting-chrome'
import { FundDetailView } from './fund-detail-view'

export const metadata: Metadata = { title: 'Fund' }

/**
 * The fund detail page — the LEAD page for a single vehicle.
 *
 * `/funds` is the whole-fund overview (every vehicle in one table); this is where a vehicle row
 * on it now leads. It carries the vehicle's key metrics (same box style as the overview and the
 * LP snapshot), the schedule-of-investments breakdown, and the growth / NAV-composition charts.
 * The operational admin — onboarding, the close, the health check, allocation settings — stays on
 * `/funds/status`, which this page links to.
 *
 * `[id]` is the vehicle's stable `fund_vehicles.id` (a UUID), the same way companies and LPs are
 * addressed — routing on the id survives a rename and sidesteps names with slashes. We resolve it
 * to the name here and hand the client the name, because the accounting data still keys on the
 * portfolio_group string. A legacy vehicle with no registry row is addressed by its name directly,
 * so an un-migrated fund still works. Like `/funds`, this page owns its layout: AccountingChrome
 * steps aside (isFundDetailPath), so there is no vehicle-selector bar — the URL pins the vehicle.
 */
export default async function FundDetailPage({ params }: { params: { id: string } }) {
  const { fundId } = await requireAccountingAccess()
  const raw = decodeURIComponent(params.id)
  // UUID → current name. Falls back to treating the param as the name itself, for legacy vehicles
  // that exist only as a portfolio_group string (no registry id to route on).
  const vehicle = (await vehicleNameById(createAdminClient(), fundId, raw)) ?? raw

  return (
    <div className="pt-4 md:pt-8 pb-8 w-full">
      <Link href="/funds" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-4">
        <ArrowLeft className="h-3.5 w-3.5" />All funds
      </Link>
      <AccountingBody>
        <FundDetailView vehicle={vehicle} />
      </AccountingBody>
    </div>
  )
}
