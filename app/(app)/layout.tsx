import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { AppHeader } from '@/components/app-header'
import { AppSidebar } from '@/components/app-sidebar'
import { AppFooter } from '@/components/app-footer'
import { DemoSeeder } from './demo-seeder'

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
    <div className="min-h-screen flex flex-col bg-background">
      {isDemo && (
        <div className="bg-amber-500 text-white text-center text-xs py-1.5 px-4 shrink-0">
          Running in demo mode — email parsing is disabled
        </div>
      )}

      <div className="w-full max-w-screen-xl mx-auto flex flex-col flex-1">
        <AppHeader
          fundName={fundName}
          userEmail={user.email ?? ''}
          reviewBadge={reviewBadge}
        />

        <div className="flex flex-1">
          {/* Desktop sidebar */}
          <aside className="hidden md:flex w-56 flex-col shrink-0 pt-4">
            <AppSidebar reviewBadge={reviewBadge} />
          </aside>

          {/* Page content */}
          <main className="flex-1 min-w-0">
            {children}
          </main>
        </div>

        <AppFooter />
      </div>

      {isDemo && <DemoSeeder />}
    </div>
  )
}
