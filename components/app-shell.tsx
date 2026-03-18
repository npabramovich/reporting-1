'use client'

import React from 'react'
import { SidebarProvider, useSidebar } from '@/components/sidebar-context'
import { CurrencyProvider } from '@/components/currency-context'
import { AnalystProvider } from '@/components/analyst-context'
import { AppFooter } from '@/components/app-footer'
import { FeatureVisibilityProvider } from '@/components/feature-visibility-context'

import { DEFAULT_FEATURE_VISIBILITY } from '@/lib/types/features'
import type { FeatureVisibilityMap } from '@/lib/types/features'

interface AppShellProps {
  fundName: string
  fundLogo: string | null
  userEmail: string
  currency?: string
  hasAIKey?: boolean
  configuredProviders?: string[]
  defaultAIProvider?: string
  featureVisibility?: FeatureVisibilityMap
  headerNode: React.ReactNode
  sidebarNode: React.ReactNode
  children: React.ReactNode
}

export function AppShell({ fundName, fundLogo, userEmail, currency, hasAIKey, configuredProviders, defaultAIProvider, featureVisibility, headerNode, sidebarNode, children }: AppShellProps) {
  return (
    <FeatureVisibilityProvider value={featureVisibility ?? DEFAULT_FEATURE_VISIBILITY}>
    <CurrencyProvider currency={currency ?? 'USD'}>
      <SidebarProvider>
        <AnalystProvider hasAIKey={hasAIKey ?? false} configuredProviders={configuredProviders ?? []} defaultAIProvider={defaultAIProvider ?? 'anthropic'} fundName={fundName}>
          <AppShellInner
            headerNode={headerNode}
            sidebarNode={sidebarNode}
          >
            {children}
          </AppShellInner>
        </AnalystProvider>
      </SidebarProvider>
    </CurrencyProvider>
    </FeatureVisibilityProvider>
  )
}

function AppShellInner({ headerNode, sidebarNode, children }: { headerNode: React.ReactNode; sidebarNode: React.ReactNode; children: React.ReactNode }) {
  const { collapsed } = useSidebar()

  return (
    <>
      {headerNode}

      <div className="flex flex-1">
        {/* Desktop sidebar — always rendered, width varies */}
        <aside
          className={`hidden md:flex flex-col shrink-0 pt-6 transition-all duration-200 ${
            collapsed ? 'w-16' : 'w-56'
          }`}
        >
          {sidebarNode}
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
