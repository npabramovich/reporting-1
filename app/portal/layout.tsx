import { getPortalFund } from '@/lib/portal-fund'
import { themeCssVars } from '@/lib/theme'
import { PortalChrome } from '@/components/portal-chrome'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { recordPortalVisit } from '@/lib/lp-access-log'

export const metadata = { title: 'Investor Portal' }

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const fund = await getPortalFund()
  const themeVars = themeCssVars(fund?.theme ?? null)
  const fundName = fund?.name ?? 'Investor Portal'

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // Best-effort login/session tracking (throttled to one event per 30 min).
  if (user && fund?.fundId) {
    await recordPortalVisit(createAdminClient(), { userId: user.id, fundId: fund.fundId })
  }

  return (
    <div className="min-h-screen bg-muted/20">
      {themeVars && <style dangerouslySetInnerHTML={{ __html: `:root{${themeVars}}` }} />}
      <PortalChrome fundName={fundName} logoUrl={fund?.logoUrl ?? null} userEmail={user?.email ?? ''}>
        {children}
      </PortalChrome>
    </div>
  )
}
