import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft, SlidersHorizontal } from 'lucide-react'
import { requireAccountingAdmin } from '../guard'
import { AllocationTermsView } from './view'

export const metadata: Metadata = { title: 'Allocation terms' }

export default async function AllocationTermsPage() {
  await requireAccountingAdmin()
  return (
    <div className="p-4 md:py-8 md:pl-8 md:pr-4 w-full">
      <Link href="/accounting" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-4">
        <ArrowLeft className="h-3.5 w-3.5" />Accounting
      </Link>
      <div className="mb-6 space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <SlidersHorizontal className="h-6 w-6" />Allocation terms
        </h1>
        <p className="text-sm text-muted-foreground">
          How the period close splits income and expenses across partners: the allocation basis,
          each partner&rsquo;s commitment over time, and who bears which categories.
        </p>
      </div>
      <AllocationTermsView />
    </div>
  )
}
