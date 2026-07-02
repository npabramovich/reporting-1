import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft, Bot } from 'lucide-react'
import { requireAccountingAdmin } from '../guard'
import { AGENT_TOOLS } from '@/lib/accounting/agent-tools'
import { AgentAccessView } from './view'

export const metadata: Metadata = { title: 'Agent access' }

export default async function AgentAccessPage() {
  await requireAccountingAdmin()
  const tools = AGENT_TOOLS.map(t => ({ name: t.name, description: t.description, scope: t.scope }))
  return (
    <div className="p-4 md:py-8 md:pl-8 md:pr-4 w-full">
      <Link href="/accounting" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-4">
        <ArrowLeft className="h-3.5 w-3.5" />Accounting
      </Link>
      <div className="mb-6 space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2"><Bot className="h-6 w-6" />Agent access</h1>
        <p className="text-sm text-muted-foreground">
          Let AI agents operate the ledger over MCP or REST — post entries, run allocations, reconcile,
          and read statements — authenticated with a fund API key. This is what makes the ledger
          AI-native: the book of record is a surface agents can drive, not just a UI.
        </p>
      </div>
      <AgentAccessView tools={tools} />
    </div>
  )
}
