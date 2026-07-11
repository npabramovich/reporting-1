import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft, Sparkles } from 'lucide-react'
import { requireAccountingAdmin } from '../guard'
import { AssistantView } from './view'

export const metadata: Metadata = { title: 'Accounting assistant' }

export default async function AccountingAssistantPage() {
  await requireAccountingAdmin()
  return (
    <div className="p-4 md:py-8 md:pl-8 md:pr-4 w-full">
      <Link href="/accounting" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-4">
        <ArrowLeft className="h-3.5 w-3.5" />Accounting
      </Link>
      <div className="mb-6 space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2"><Sparkles className="h-6 w-6" />Accounting assistant</h1>
        <p className="text-sm text-muted-foreground">
          Ask the AI to review your books or draft an entry. It reads this vehicle&apos;s chart,
          balances, and recent entries, and proposes journal entries or edits — which you apply as
          drafts to review and post. Nothing is posted automatically.
        </p>
      </div>
      <AssistantView />
    </div>
  )
}
