import { redirect } from 'next/navigation'
import Script from 'next/script'
import { createClient } from '@/lib/supabase/server'
import { AppShell } from '@/components/app-shell'
import { DemoSessionGuard } from '@/components/demo-session-guard'
import {
  getFundData,
  getFundSettings,
  getMembership,
} from '@/lib/cache/layout'
import { AppHeaderServer, AppSidebarServer } from '@/components/app-shell-server'
import { AppHeader } from '@/components/app-header'
import { AppSidebar } from '@/components/app-sidebar'
import React, { Suspense } from 'react'

import { DEFAULT_FEATURE_VISIBILITY } from '@/lib/types/features'
import type { FeatureVisibilityMap } from '@/lib/types/features'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Auth — uncached (uses cookies)
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth')

  // Get fund ID (uncached — quick single query, needed to key everything else)
  const { data: fund } = await supabase.from('funds').select('id').limit(1).single() as { data: { id: string } | null }
  if (!fund) redirect('/onboarding')

  // Fast cached queries in parallel
  const [fundData, membership, fundSettings] = await Promise.all([
    getFundData(fund.id),
    getMembership(user.id, fund.id),
    getFundSettings(fund.id),
  ])

  const isAdmin = membership?.role === 'admin'
  const isViewer = membership?.role === 'viewer'

  const featureVisibility = { ...DEFAULT_FEATURE_VISIBILITY, ...(fundSettings?.feature_visibility as Partial<FeatureVisibilityMap> | null) }
  const fundCurrency = fundSettings?.currency ?? 'USD'
  const configuredProviders = [
    fundSettings?.claude_api_key_encrypted ? 'anthropic' : null,
    fundSettings?.openai_api_key_encrypted ? 'openai' : null,
    fundSettings?.gemini_api_key_encrypted ? 'gemini' : null,
    fundSettings?.ollama_base_url ? 'ollama' : null,
  ].filter(Boolean) as string[]
  const hasAIKey = configuredProviders.length > 0
  const defaultAIProvider = fundSettings?.default_ai_provider ?? 'anthropic'
  const fathomSiteId = fundSettings?.analytics_fathom_site_id ?? null
  const rawGaId = fundSettings?.analytics_ga_measurement_id ?? null
  const gaMeasurementId = rawGaId && /^[A-Z0-9-]+$/i.test(rawGaId) ? rawGaId : null
  const fundName = fundData?.name ?? 'Portfolio Reporting'
  const fundLogo = fundData?.logo_url ?? null

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {isViewer && (
        <>
          <DemoSessionGuard />
          <div className="bg-blue-500 text-white text-center text-xs py-1.5 px-4 shrink-0 flex items-center justify-center gap-3">
            <span>Viewing demo &mdash; read only</span>
            <a href="/api/auth/logout" className="underline underline-offset-2 hover:text-white/80">Exit demo</a>
          </div>
        </>
      )}

      <div className="w-full max-w-screen-xl mx-auto flex flex-col flex-1">
        <AppShell
          fundName={fundName}
          fundLogo={fundLogo}
          userEmail={user.email ?? ''}
          currency={fundCurrency}
          hasAIKey={hasAIKey}
          configuredProviders={configuredProviders}
          defaultAIProvider={defaultAIProvider}
          featureVisibility={featureVisibility}
          headerNode={
            <Suspense fallback={<AppHeader fundName={fundName} fundLogo={fundLogo} userEmail={user.email ?? ''} reviewBadge={0} isAdmin={isAdmin} featureVisibility={featureVisibility} />}>
              <AppHeaderServer fundId={fund.id} userId={user.id} fundName={fundName} fundLogo={fundLogo} userEmail={user.email ?? ''} isAdmin={isAdmin} featureVisibility={featureVisibility} />
            </Suspense>
          }
          sidebarNode={
            <Suspense fallback={<AppSidebar reviewBadge={0} isAdmin={isAdmin} featureVisibility={featureVisibility} />}>
              <AppSidebarServer fundId={fund.id} userId={user.id} isAdmin={isAdmin} featureVisibility={featureVisibility} />
            </Suspense>
          }
        >
          {children}
        </AppShell>
      </div>

      {fathomSiteId && (
        <Script src="https://cdn.usefathom.com/script.js" data-site={fathomSiteId} strategy="afterInteractive" defer />
      )}
      {gaMeasurementId && (
        <>
          <Script src={`https://www.googletagmanager.com/gtag/js?id=${gaMeasurementId}`} strategy="afterInteractive" />
          <Script id="ga-config" strategy="afterInteractive">{`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config',${JSON.stringify(gaMeasurementId)});`}</Script>
        </>
      )}
    </div>
  )
}
