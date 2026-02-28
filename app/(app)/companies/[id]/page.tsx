import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { ArrowLeft } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import type { Company, Metric } from '@/lib/types/database'
import { CompanyCharts } from './company-charts'
import { CompanySummary } from './company-summary'

export default async function CompanyDetailPage({
  params,
}: {
  params: { id: string }
}) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth')

  const { data: company } = await supabase
    .from('companies')
    .select('*')
    .eq('id', params.id)
    .maybeSingle() as { data: Company | null }

  if (!company) redirect('/companies')

  const { data: metrics } = await supabase
    .from('metrics')
    .select('*')
    .eq('company_id', params.id)
    .eq('is_active', true)
    .order('display_order') as { data: Metric[] | null }

  return (
    <div className="p-4 md:p-8 max-w-6xl">
      <div className="mb-6">
        <Link
          href="/companies"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Companies
        </Link>

        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-2xl font-semibold tracking-tight">{company.name}</h1>
          {company.stage && (
            <Badge variant="secondary">{company.stage}</Badge>
          )}
          {company.industry && (
            <Badge variant="outline">{company.industry}</Badge>
          )}
        </div>

        {(company.founders || company.contact_email) && (
          <div className="flex items-center gap-4 text-sm text-muted-foreground mt-2">
            {company.founders && <span>Founders: {company.founders}</span>}
            {company.contact_email && (
              <a href={`mailto:${company.contact_email}`} className="hover:underline">
                {company.contact_email}
              </a>
            )}
          </div>
        )}

        {company.overview && (
          <div className="mt-4">
            <h3 className="text-sm font-medium text-muted-foreground mb-1">Overview</h3>
            <p className="text-sm">{company.overview}</p>
          </div>
        )}

        {company.why_invested && (
          <div className="mt-3">
            <h3 className="text-sm font-medium text-muted-foreground mb-1">Why We Invested</h3>
            <p className="text-sm">{company.why_invested}</p>
          </div>
        )}

        {company.current_update && (
          <div className="mt-3">
            <h3 className="text-sm font-medium text-muted-foreground mb-1">Current Business Update</h3>
            <p className="text-sm">{company.current_update}</p>
          </div>
        )}
      </div>

      <CompanySummary companyId={company.id} />

      <CompanyCharts
        companyId={company.id}
        companyName={company.name}
        metrics={metrics ?? []}
      />
    </div>
  )
}
