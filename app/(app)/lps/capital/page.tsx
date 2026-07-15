import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { DEFAULT_FEATURE_VISIBILITY, isFeatureVisible } from '@/lib/types/features'
import type { FeatureVisibilityMap } from '@/lib/types/features'
import { LpCapitalView } from './view'

export const metadata: Metadata = { title: 'LP capital accounts' }

/**
 * LP capital accounts, in the LPs section — the canonical home for them.
 *
 * Gated on `lp_tracking`, NOT on accounting: this works whether or not the fund keeps books.
 * When a vehicle is on the ledger, the accounts come from it; otherwise they come from the
 * pasted / manually-entered dated positions edited on this same page. Either way it is the
 * same capital-account statement — a tracking-only one just has fewer lines.
 */
export default async function LpCapitalPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth')

  const admin = createAdminClient()
  const { data: membership } = await admin
    .from('fund_members').select('fund_id, role').eq('user_id', user.id).maybeSingle() as { data: { fund_id: string; role: string } | null }
  if (!membership) redirect('/dashboard')

  const { data: fs } = await (admin as any)
    .from('fund_settings').select('feature_visibility').eq('fund_id', membership.fund_id).maybeSingle()
  const fv: FeatureVisibilityMap = { ...DEFAULT_FEATURE_VISIBILITY, ...(fs?.feature_visibility ?? {}) }
  if (!isFeatureVisible(fv, 'lp_tracking', membership.role === 'admin')) redirect('/dashboard')

  return (
    <div className="px-4 md:pl-8 md:pr-4 pt-3 pb-8 w-full">
      <div className="mb-6 space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">LP capital accounts</h1>
        <p className="text-sm text-muted-foreground">
          Per-vehicle LP capital, from the ledger where you keep books, or from pasted positions where you don&rsquo;t.
        </p>
      </div>
      <LpCapitalView isAdmin={membership.role === 'admin'} />
    </div>
  )
}
