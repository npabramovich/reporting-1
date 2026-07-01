'use client'

import Link from 'next/link'
import { LpAccessSettings } from '@/components/lp-access-settings'
import { LpDocumentsSettings } from '@/components/lp-documents-settings'
import { LpMessagesSection } from '@/components/lp-messages-section'
import { AnalystToggleButton } from '@/components/analyst-button'
import { AnalystPanel } from '@/components/analyst-panel'

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-card p-5">
      <h2 className="text-sm font-medium mb-1">{title}</h2>
      {description && <p className="text-xs text-muted-foreground mb-4">{description}</p>}
      {children}
    </div>
  )
}

export function LpPortalDashboard() {
  return (
    <div className="p-4 md:py-8 md:pl-8 md:pr-4">
      <div className="flex items-start justify-between gap-4 mb-1">
        <h1 className="text-2xl font-semibold tracking-tight">Documents</h1>
        <AnalystToggleButton />
      </div>
      <p className="text-sm text-muted-foreground mb-6">
        Manage everything your investors see in their portal — invitations, shared documents, and their messages.
        Turn the portal on or off in <Link href="/settings" className="underline underline-offset-2 hover:text-foreground">Settings</Link>.
      </p>

      <div className="space-y-6">
        <Section title="LP access" description="Invite LPs and their authorized users, in bulk from a pasted sheet, or one at a time. Investors are matched by name; new ones are created.">
          <LpAccessSettings />
        </Section>
        <Section title="LP documents">
          <LpDocumentsSettings />
        </Section>
        <Section title="LP messages">
          <LpMessagesSection />
        </Section>
      </div>

      <AnalystPanel />
    </div>
  )
}
