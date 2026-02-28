import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { LayoutDashboard, Building2, Mail, Upload, Settings } from 'lucide-react'
import { Separator } from '@/components/ui/separator'
import { AppHeader } from '@/components/app-header'
import { AppSidebar } from '@/components/app-sidebar'
import { AppFooter } from '@/components/app-footer'
import { DemoSeeder } from './demo-seeder'

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/companies', label: 'Companies', icon: Building2 },
  { href: '/emails', label: 'Email Log', icon: Mail, badge: true },
  { href: '/import', label: 'Import', icon: Upload },
  { href: '/settings', label: 'Settings', icon: Settings },
]

const isDemo = process.env.DEMO_MODE === 'true'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth')

  const { count: openReviewCount } = await supabase
    .from('inbound_emails')
    .select('id', { count: 'exact', head: true })
    .eq('processing_status', 'needs_review')

  const { data: fund } = await supabase
    .from('funds')
    .select('name')
    .limit(1)
    .single() as { data: { name: string } | null }

  const reviewBadge = openReviewCount ?? 0
  const fundName = fund?.name ?? 'Portfolio Reporting'

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      {isDemo && (
        <div className="bg-amber-500 text-white text-center text-xs py-1.5 px-4 shrink-0">
          Running in demo mode — email parsing is disabled
        </div>
      )}

      <AppHeader
        fundName={fundName}
        userEmail={user.email ?? ''}
        navItems={NAV_ITEMS}
        reviewBadge={reviewBadge}
      />

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Desktop sidebar */}
        <aside className="hidden md:flex w-56 border-r bg-card flex-col shrink-0">
          <AppSidebar navItems={NAV_ITEMS} reviewBadge={reviewBadge} />
          <Separator />
        </aside>

        {/* Page content */}
        <main className="flex-1 overflow-auto bg-background">
          {children}
        </main>
      </div>

      <AppFooter />

      {isDemo && <DemoSeeder />}
    </div>
  )
}
