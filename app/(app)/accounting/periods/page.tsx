import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft, Lock } from 'lucide-react'
import { requireAccountingAdmin } from '../guard'
import { PeriodsView } from './view'

export const metadata: Metadata = { title: 'Periods' }

export default async function PeriodsPage() {
  await requireAccountingAdmin()
  return (
    <div className="p-4 md:py-8 md:pl-8 md:pr-4 w-full">
      <Link href="/accounting" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-4">
        <ArrowLeft className="h-3.5 w-3.5" />Accounting
      </Link>
      <div className="mb-6 space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2"><Lock className="h-6 w-6" />Periods</h1>
        <p className="text-sm text-muted-foreground">
          Close and lock a reporting period. A closed period freezes the books for its date range —
          new postings dated inside it are blocked until you reopen — and snapshots the ledger as
          text for the audit trail.
        </p>
      </div>
      <PeriodsView />
    </div>
  )
}
