'use client'

import { SidebarProvider, useSidebar } from '@/components/sidebar-context'
import { CurrencyProvider } from '@/components/currency-context'
import { AnalystProvider } from '@/components/analyst-context'
import { AppHeader } from '@/components/app-header'
import { AppSidebar } from '@/components/app-sidebar'
import { AppFooter } from '@/components/app-footer'

interface AppShellProps {
  fundName: string
  fundLogo: string | null
  userEmail: string
  reviewBadge: number
  settingsBadge?: number
  notesBadge?: number
  isAdmin?: boolean
  currency?: string
  hasAIKey?: boolean
  defaultAIProvider?: string
  updateAvailable?: boolean
  children: React.ReactNode
}

export function AppShell({ fundName, fundLogo, userEmail, reviewBadge, settingsBadge, notesBadge, isAdmin, currency, hasAIKey, defaultAIProvider, updateAvailable, children }: AppShellProps) {
  return (
    <CurrencyProvider currency={currency ?? 'USD'}>
      <SidebarProvider>
        <AnalystProvider hasAIKey={hasAIKey ?? false} defaultAIProvider={defaultAIProvider ?? 'anthropic'} fundName={fundName}>
          <AppShellInner
            fundName={fundName}
            fundLogo={fundLogo}
            userEmail={userEmail}
            reviewBadge={reviewBadge}
            settingsBadge={settingsBadge}
            notesBadge={notesBadge}
            isAdmin={isAdmin}
            updateAvailable={updateAvailable}
          >
            {children}
          </AppShellInner>
        </AnalystProvider>
      </SidebarProvider>
    </CurrencyProvider>
  )
}

function AppShellInner({ fundName, fundLogo, userEmail, reviewBadge, settingsBadge, notesBadge, isAdmin, updateAvailable, children }: AppShellProps) {
  const { collapsed } = useSidebar()

  return (
    <>
      <AppHeader
        fundName={fundName}
        fundLogo={fundLogo}
        userEmail={userEmail}
        reviewBadge={reviewBadge}
        settingsBadge={settingsBadge}
        notesBadge={notesBadge}
        isAdmin={isAdmin}
      />

      <div className="flex flex-1">
        {/* Desktop sidebar — always rendered, width varies */}
        <aside
          className={`hidden md:flex flex-col shrink-0 pt-6 transition-all duration-200 ${
            collapsed ? 'w-16' : 'w-56'
          }`}
        >
          <AppSidebar reviewBadge={reviewBadge} settingsBadge={settingsBadge} notesBadge={notesBadge} isAdmin={isAdmin} updateAvailable={updateAvailable} />
        </aside>

        {/* Page content */}
        <main className="flex-1 min-w-0 flex flex-col">
          <div className="flex-1">
            {children}
          </div>
          <AppFooter />
        </main>
      </div>
    </>
  )
}
