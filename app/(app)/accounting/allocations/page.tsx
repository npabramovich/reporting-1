import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft, Calculator } from 'lucide-react'
import { requireAccountingAdmin } from '../guard'
import { AllocationsView } from './view'

export const metadata: Metadata = { title: 'Allocations' }

export default async function AllocationsPage() {
  await requireAccountingAdmin()
  return (
    <div className="p-4 md:py-8 md:pl-8 md:pr-4 w-full">
      <Link href="/accounting" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-4">
        <ArrowLeft className="h-3.5 w-3.5" />Accounting
      </Link>
      <div className="mb-6 space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2"><Calculator className="h-6 w-6" />Allocations</h1>
        <p className="text-sm text-muted-foreground">
          Compute and post a period allocation — management fee or partnership expense — split per
          LP and booked as a balanced entry to each capital account.
        </p>
      </div>
      <AllocationsView />
    </div>
  )
}
