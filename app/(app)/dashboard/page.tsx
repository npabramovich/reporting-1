import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { AlertCircle, Mail, Clock } from 'lucide-react'
import type { Fund } from '@/lib/types/database'
import { DashboardSparklines } from './dashboard-sparklines'

export default async function DashboardPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth')

  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()

  const { data: fund } = await supabase
    .from('funds')
    .select('name')
    .limit(1)
    .maybeSingle() as { data: Pick<Fund, 'name'> | null }

  const [
    { count: companyCount },
    { count: reviewCount },
    { count: recentEmailCount },
    { count: failedEmailCount },
  ] = await Promise.all([
    supabase.from('companies').select('id', { count: 'exact', head: true }).eq('status', 'active'),
    supabase.from('parsing_reviews').select('id', { count: 'exact', head: true }).is('resolution', null),
    supabase.from('inbound_emails').select('id', { count: 'exact', head: true }).gte('received_at', ninetyDaysAgo),
    supabase.from('inbound_emails').select('id', { count: 'exact', head: true }).eq('processing_status', 'failed'),
  ])

  // Fetch companies with their first 2 metrics and review counts
  type CompanyRow = {
    id: string; name: string; stage: string | null; status: string
    metrics: { id: string; name: string; unit: string | null; unit_position: string; value_type: string; display_order: number; is_active: boolean }[]
    inbound_emails: { received_at: string }[]
    parsing_reviews: { id: string; resolution: string | null }[]
  }

  const { data: companiesRaw } = await supabase
    .from('companies')
    .select(`
      id, name, stage, status,
      metrics(id, name, unit, unit_position, value_type, display_order, is_active),
      inbound_emails(received_at),
      parsing_reviews(id, resolution)
    `)
    .eq('status', 'active')
    .order('name') as { data: CompanyRow[] | null }

  const companies = (companiesRaw ?? []).map((c) => {
    const emails = c.inbound_emails ?? []
    const lastReportAt = emails.length > 0
      ? emails.reduce((max, e) => (e.received_at > max ? e.received_at : max), emails[0].received_at)
      : null
    const activeMetrics = (c.metrics ?? [])
      .filter((m) => m.is_active)
      .sort((a, b) => a.display_order - b.display_order)
      .slice(0, 2)
    const openReviews = (c.parsing_reviews ?? []).filter((r) => r.resolution === null).length
    const stale = lastReportAt ? new Date(lastReportAt) < new Date(ninetyDaysAgo) : true

    return {
      id: c.id,
      name: c.name,
      stage: c.stage,
      lastReportAt,
      stale,
      openReviews,
      sparkMetrics: activeMetrics,
    }
  })

  // Stale companies count
  const staleCompanyCount = companies.filter((c) => c.stale && companies.length > 0).length

  return (
    <div className="p-4 md:p-8 max-w-6xl">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">
          {fund?.name ?? 'Dashboard'}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Portfolio overview</p>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <StatCard label="Active companies" value={companyCount ?? 0} />
        <StatCard label="Reports (last 90 days)" value={recentEmailCount ?? 0} />
        <StatCard
          label="Open reviews"
          value={reviewCount ?? 0}
          highlight={!!reviewCount}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-6">
        {/* Company cards grid */}
        <div>
          <h2 className="text-sm font-medium text-muted-foreground mb-3">
            Portfolio companies
          </h2>
          {companies.length === 0 ? (
            <div className="rounded-lg border border-dashed p-12 text-center">
              <p className="text-muted-foreground">No companies yet.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {companies.map((c) => (
                <Link
                  key={c.id}
                  href={`/companies/${c.id}`}
                  className="rounded-lg border bg-card p-4 hover:bg-accent/50 transition-colors"
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{c.name}</span>
                      {c.stage && (
                        <span className="text-[10px] text-muted-foreground bg-secondary px-1.5 py-0.5 rounded">
                          {c.stage}
                        </span>
                      )}
                    </div>
                    {c.openReviews > 0 && (
                      <span className="rounded-full bg-amber-500 text-white text-[10px] font-semibold leading-none px-1.5 py-0.5 min-w-[18px] text-center">
                        {c.openReviews}
                      </span>
                    )}
                  </div>

                  <p className="text-xs text-muted-foreground mb-3">
                    {c.lastReportAt
                      ? `Last report ${new Date(c.lastReportAt).toLocaleDateString()}`
                      : 'No reports yet'}
                  </p>

                  {c.sparkMetrics.length > 0 && (
                    <DashboardSparklines
                      companyId={c.id}
                      metrics={c.sparkMetrics}
                    />
                  )}
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Alerts panel */}
        <div>
          <h2 className="text-sm font-medium text-muted-foreground mb-3">Alerts</h2>
          <div className="space-y-2">
            {(reviewCount ?? 0) > 0 && (
              <Link
                href="/review"
                className="flex items-center gap-3 rounded-lg border p-3 hover:bg-accent/50 transition-colors"
              >
                <AlertCircle className="h-4 w-4 text-amber-500 shrink-0" />
                <div>
                  <p className="text-sm font-medium">{reviewCount} open review{(reviewCount ?? 0) !== 1 ? 's' : ''}</p>
                  <p className="text-xs text-muted-foreground">Items need your attention</p>
                </div>
              </Link>
            )}

            {(failedEmailCount ?? 0) > 0 && (
              <Link
                href="/emails?status=failed"
                className="flex items-center gap-3 rounded-lg border p-3 hover:bg-accent/50 transition-colors"
              >
                <Mail className="h-4 w-4 text-destructive shrink-0" />
                <div>
                  <p className="text-sm font-medium">{failedEmailCount} failed email{(failedEmailCount ?? 0) !== 1 ? 's' : ''}</p>
                  <p className="text-xs text-muted-foreground">Processing errors to investigate</p>
                </div>
              </Link>
            )}

            {staleCompanyCount > 0 && (
              <div className="flex items-center gap-3 rounded-lg border p-3">
                <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
                <div>
                  <p className="text-sm font-medium">{staleCompanyCount} stale compan{staleCompanyCount !== 1 ? 'ies' : 'y'}</p>
                  <p className="text-xs text-muted-foreground">No reports in 90+ days</p>
                </div>
              </div>
            )}

            {(reviewCount ?? 0) === 0 && (failedEmailCount ?? 0) === 0 && staleCompanyCount === 0 && (
              <div className="rounded-lg border border-dashed p-6 text-center">
                <p className="text-sm text-muted-foreground">All clear — no alerts.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function StatCard({
  label,
  value,
  highlight,
}: {
  label: string
  value: number
  highlight?: boolean
}) {
  return (
    <div
      className={`rounded-lg border p-5 ${
        highlight ? 'border-amber-200 bg-amber-50' : 'bg-card'
      }`}
    >
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-3xl font-semibold mt-1">{value}</p>
    </div>
  )
}
