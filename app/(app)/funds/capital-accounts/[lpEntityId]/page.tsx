import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { requireAccountingAccess } from '../../guard'
import { LpStatementView } from './view'

export const metadata: Metadata = { title: 'LP capital statement' }

export default async function LpStatementPage({
  params, searchParams,
}: {
  params: { lpEntityId: string }
  searchParams: { from?: string }
}) {
  await requireAccountingAccess()
  // Return to wherever the LP was opened from: the LP capital-accounts page marks its links
  // with `?from=lps`; everything else (the Funds capital-accounts table) uses the default.
  const fromLps = searchParams?.from === 'lps'
  const backHref = fromLps ? '/lps/capital' : '/funds/capital-accounts'
  const backLabel = fromLps ? 'LP capital accounts' : 'Capital accounts'
  return (
    <div className="pt-3 pb-8 w-full">
      <Link href={backHref} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-4">
        <ArrowLeft className="h-3.5 w-3.5" />{backLabel}
      </Link>
      <div className="mb-6 space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">LP capital statement</h1>
      </div>
      <LpStatementView lpEntityId={params.lpEntityId} />
    </div>
  )
}
