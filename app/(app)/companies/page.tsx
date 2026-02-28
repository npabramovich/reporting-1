import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Badge } from '@/components/ui/badge'

export default async function CompaniesPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth')

  const { data } = await supabase
    .from('companies')
    .select('id, name, stage, status, industry, tags, metrics(id), inbound_emails(received_at)')
    .order('name') as { data: Array<{
      id: string; name: string; stage: string | null; status: string; industry: string | null
      tags: string[]
      metrics: { id: string }[]; inbound_emails: { received_at: string }[]
    }> | null }

  const companies = (data ?? []).map((c) => {
    const emails = c.inbound_emails ?? []
    const lastReportAt = emails.length > 0
      ? emails.reduce((max, e) => (e.received_at > max ? e.received_at : max), emails[0].received_at)
      : null
    return {
      id: c.id,
      name: c.name,
      stage: c.stage,
      status: c.status,
      industry: c.industry,
      tags: c.tags ?? [],
      metricsCount: c.metrics?.length ?? 0,
      lastReportAt,
    }
  })

  return (
    <div className="p-4 md:p-8 max-w-4xl">
      <h1 className="text-2xl font-semibold tracking-tight mb-6">Companies</h1>

      {companies.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center">
          <p className="text-muted-foreground">No companies yet.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {companies.map((c) => (
            <Link
              key={c.id}
              href={`/companies/${c.id}`}
              className="flex items-center justify-between p-4 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
            >
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium">{c.name}</span>
                {c.tags.map(tag => (
                  <Badge key={tag} variant="outline" className="text-[10px]">{tag}</Badge>
                ))}
                {c.stage && <Badge variant="secondary" className="text-[10px]">{c.stage}</Badge>}
                {c.status !== 'active' && (
                  <Badge variant="outline" className="text-[10px]">{c.status}</Badge>
                )}
              </div>
              <div className="flex items-center gap-4 sm:gap-6 text-xs text-muted-foreground shrink-0">
                <span>{c.metricsCount} metric{c.metricsCount !== 1 ? 's' : ''}</span>
                <span>
                  {c.lastReportAt
                    ? `Last report ${new Date(c.lastReportAt).toLocaleDateString()}`
                    : 'No reports yet'}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
