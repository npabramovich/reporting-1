import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft, Landmark } from 'lucide-react'
import { requireAccountingAdmin } from '../guard'
import { BankView } from './view'

export const metadata: Metadata = { title: 'Bank transactions' }

export default async function BankPage() {
  await requireAccountingAdmin()
  return (
    <div className="p-4 md:py-8 md:pl-8 md:pr-4 w-full">
      <Link href="/accounting" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-4">
        <ArrowLeft className="h-3.5 w-3.5" />Accounting
      </Link>
      <div className="mb-6 space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2"><Landmark className="h-6 w-6" />Bank transactions</h1>
        <p className="text-sm text-muted-foreground">
          Import a transaction feed from any source, review the drafted entries, and reconcile the
          ledger&rsquo;s cash against the bank. The staging layer every connector (Plaid, Ramp,
          QuickBooks) will feed.
        </p>
      </div>
      <BankView />
    </div>
  )
}
