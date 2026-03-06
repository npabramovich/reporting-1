import { createAdminClient } from '@/lib/supabase/admin'

type Admin = ReturnType<typeof createAdminClient>

export interface CompanyInvestmentSummary {
  companyId: string
  companyName: string
  status: string
  stage: string | null
  industry: string[] | null
  overview: string | null
  whyInvested: string | null
  currentUpdate: string | null
  totalInvested: number
  totalRealized: number
  unrealizedValue: number
  fmv: number
  moic: number | null
}

export interface CompanyMetricData {
  metricName: string
  unit: string | null
  unitPosition: string
  valueType: string
  currency: string | null
  // Values for the requested quarter
  currentValue: number | string | null
  currentLabel: string
  // Previous quarter for comparison
  previousValue: number | string | null
  previousLabel: string | null
  // Year-end: full year values (if is_year_end)
  yearValues?: { label: string; value: number | string | null }[]
}

export interface CompanyLetterData {
  investment: CompanyInvestmentSummary
  metrics: CompanyMetricData[]
  recentNotes: string[]
  latestSummary: string | null
  latestUpdate: string | null
}

export interface PortfolioPreview {
  fundName: string
  fundCurrency: string
  periodLabel: string
  portfolioGroup: string
  companies: CompanyLetterData[]
  totals: {
    totalInvested: number
    totalFmv: number
    totalRealized: number
    portfolioMoic: number | null
    activeCount: number
    exitedCount: number
    writtenOffCount: number
  }
}

/**
 * Aggregates all portfolio data for a given quarter + portfolio group.
 * Used both for the preview step and for feeding into AI generation.
 */
export async function aggregatePortfolioData(
  admin: Admin,
  fundId: string,
  year: number,
  quarter: number,
  portfolioGroup: string,
  isYearEnd: boolean
): Promise<PortfolioPreview> {
  // Fund info
  const { data: fund } = await admin
    .from('funds')
    .select('name')
    .eq('id', fundId)
    .single()

  const { data: fundSettings } = await admin
    .from('fund_settings')
    .select('currency')
    .eq('fund_id', fundId)
    .maybeSingle()

  const fundCurrency = fundSettings?.currency ?? 'USD'
  const fundName = fund?.name ?? 'Fund'

  // Get companies in this portfolio group
  const { data: allCompanies } = await admin
    .from('companies')
    .select('id, name, status, stage, industry, overview, why_invested, current_update')
    .eq('fund_id', fundId)
    .eq('status', 'active')
    .order('name') as { data: {
      id: string; name: string; status: string; stage: string | null
      industry: string[] | null; overview: string | null
      why_invested: string | null; current_update: string | null
    }[] | null }

  // Filter by portfolio group using investment transactions
  const { data: allTransactions } = await admin
    .from('investment_transactions')
    .select('company_id, transaction_type, investment_cost, proceeds_received, proceeds_escrow, current_share_price, shares_acquired, unrealized_value_change, portfolio_group')
    .eq('fund_id', fundId) as { data: {
      company_id: string; transaction_type: string; investment_cost: number | null
      proceeds_received: number | null; proceeds_escrow: number | null
      current_share_price: number | null; shares_acquired: number | null
      unrealized_value_change: number | null; portfolio_group: string[] | null
    }[] | null }

  // Determine which companies belong to this portfolio group
  const companyIdsInGroup = new Set<string>()
  for (const t of allTransactions ?? []) {
    const groups = t.portfolio_group ?? []
    if (groups.includes(portfolioGroup)) {
      companyIdsInGroup.add(t.company_id)
    }
  }

  // Also include companies that have no transactions but are assigned to this group
  // (via company-level portfolio_group field)
  const { data: companyGroupAssignments } = await admin
    .from('companies')
    .select('id, portfolio_group')
    .eq('fund_id', fundId) as { data: { id: string; portfolio_group: string[] | null }[] | null }

  for (const c of companyGroupAssignments ?? []) {
    if (c.portfolio_group?.includes(portfolioGroup)) {
      companyIdsInGroup.add(c.id)
    }
  }

  const companies = (allCompanies ?? []).filter(c => companyIdsInGroup.has(c.id))

  // Also get exited/written-off companies in this group
  const { data: inactiveCompanies } = await admin
    .from('companies')
    .select('id, name, status, stage, industry, overview, why_invested, current_update')
    .eq('fund_id', fundId)
    .in('status', ['exited', 'written-off']) as { data: typeof allCompanies }

  const allGroupCompanies = [
    ...companies,
    ...(inactiveCompanies ?? []).filter(c => companyIdsInGroup.has(c.id)),
  ]

  // Compute investment summaries
  const investmentSummaries: CompanyInvestmentSummary[] = []
  for (const c of allGroupCompanies) {
    const txns = (allTransactions ?? []).filter(t => t.company_id === c.id)
    let totalInvested = 0
    let totalRealized = 0
    let shares = 0
    let latestSharePrice = 0

    for (const t of txns) {
      if (t.transaction_type === 'investment') {
        totalInvested += Number(t.investment_cost ?? 0)
        shares += Number(t.shares_acquired ?? 0)
      }
      if (t.transaction_type === 'proceeds') {
        totalRealized += Number(t.proceeds_received ?? 0) + Number(t.proceeds_escrow ?? 0)
      }
      if (t.transaction_type === 'unrealized_gain_change' && t.current_share_price) {
        latestSharePrice = Number(t.current_share_price)
      }
    }

    const unrealizedValue = shares > 0 && latestSharePrice > 0 ? shares * latestSharePrice : 0
    const fmv = c.status === 'exited' ? totalRealized
      : c.status === 'written-off' ? 0
      : totalRealized + unrealizedValue
    const moic = totalInvested > 0 ? fmv / totalInvested : null

    investmentSummaries.push({
      companyId: c.id,
      companyName: c.name,
      status: c.status,
      stage: c.stage,
      industry: c.industry,
      overview: c.overview,
      whyInvested: c.why_invested,
      currentUpdate: c.current_update,
      totalInvested,
      totalRealized,
      unrealizedValue,
      fmv,
      moic,
    })
  }

  // Fetch metrics for all companies in the group
  const companyIds = allGroupCompanies.map(c => c.id)
  const { data: allMetrics } = await admin
    .from('metrics')
    .select('id, company_id, name, unit, unit_position, value_type, currency')
    .in('company_id', companyIds.length > 0 ? companyIds : ['__none__'])
    .eq('is_active', true) as { data: {
      id: string; company_id: string; name: string; unit: string | null
      unit_position: string; value_type: string; currency: string | null
    }[] | null }

  const metricIds = (allMetrics ?? []).map(m => m.id)
  const { data: allValues } = await admin
    .from('metric_values')
    .select('metric_id, period_label, period_year, period_quarter, period_month, value_number, value_text')
    .in('metric_id', metricIds.length > 0 ? metricIds : ['__none__'])
    .order('period_year')
    .order('period_quarter', { nullsFirst: true })
    .order('period_month', { nullsFirst: true }) as { data: {
      metric_id: string; period_label: string; period_year: number
      period_quarter: number | null; period_month: number | null
      value_number: number | null; value_text: string | null
    }[] | null }

  // Determine the previous quarter
  const prevQ = quarter === 1 ? 4 : quarter - 1
  const prevY = quarter === 1 ? year - 1 : year

  // Fetch recent notes and summaries per company
  const companyDataMap = new Map<string, CompanyLetterData>()
  for (const c of allGroupCompanies) {
    const inv = investmentSummaries.find(s => s.companyId === c.id)!
    const metrics = (allMetrics ?? []).filter(m => m.company_id === c.id)

    const metricData: CompanyMetricData[] = metrics.map(m => {
      const vals = (allValues ?? []).filter(v => v.metric_id === m.id)
      const currentVals = vals.filter(v => v.period_year === year && v.period_quarter === quarter)
      const prevVals = vals.filter(v => v.period_year === prevY && v.period_quarter === prevQ)
      const current = currentVals[currentVals.length - 1]
      const prev = prevVals[prevVals.length - 1]

      const yearValues = isYearEnd
        ? vals.filter(v => v.period_year === year).map(v => ({
            label: v.period_label,
            value: v.value_number !== null ? v.value_number : v.value_text,
          }))
        : undefined

      return {
        metricName: m.name,
        unit: m.unit,
        unitPosition: m.unit_position,
        valueType: m.value_type,
        currency: m.currency,
        currentValue: current ? (current.value_number !== null ? current.value_number : current.value_text) : null,
        currentLabel: current?.period_label ?? `Q${quarter} ${year}`,
        previousValue: prev ? (prev.value_number !== null ? prev.value_number : prev.value_text) : null,
        previousLabel: prev?.period_label ?? null,
        yearValues,
      }
    })

    // Recent notes
    const { data: notes } = await admin
      .from('company_notes')
      .select('content')
      .eq('company_id', c.id)
      .order('created_at', { ascending: false })
      .limit(5) as { data: { content: string }[] | null }

    // Latest summary
    const { data: summary } = await admin
      .from('company_summaries')
      .select('summary_text')
      .eq('company_id', c.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle() as { data: { summary_text: string } | null }

    companyDataMap.set(c.id, {
      investment: inv,
      metrics: metricData,
      recentNotes: (notes ?? []).map(n => n.content),
      latestSummary: summary?.summary_text ?? null,
      latestUpdate: c.current_update,
    })
  }

  // Compute totals
  const activeCompanies = investmentSummaries.filter(s => s.status === 'active')
  const totalInvested = investmentSummaries.reduce((s, c) => s + c.totalInvested, 0)
  const totalFmv = investmentSummaries.reduce((s, c) => s + c.fmv, 0)
  const totalRealized = investmentSummaries.reduce((s, c) => s + c.totalRealized, 0)
  const portfolioMoic = totalInvested > 0 ? totalFmv / totalInvested : null

  const periodLabel = isYearEnd
    ? `Q${quarter} ${year} / Year End ${year}`
    : `Q${quarter} ${year}`

  return {
    fundName,
    fundCurrency,
    periodLabel,
    portfolioGroup,
    companies: allGroupCompanies.map(c => companyDataMap.get(c.id)!),
    totals: {
      totalInvested,
      totalFmv,
      totalRealized,
      portfolioMoic,
      activeCount: activeCompanies.length,
      exitedCount: investmentSummaries.filter(s => s.status === 'exited').length,
      writtenOffCount: investmentSummaries.filter(s => s.status === 'written-off').length,
    },
  }
}
