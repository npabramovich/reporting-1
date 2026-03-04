import { createAdminClient } from '@/lib/supabase/admin'
import {
  extractAttachmentText,
  hydrateAttachments,
  type PostmarkPayload,
} from '@/lib/parsing/extractAttachmentText'

type Admin = ReturnType<typeof createAdminClient>

export interface PortfolioContext {
  systemPrompt: string
  portfolioBlock: string
}

export async function buildPortfolioContext(
  admin: Admin,
  fundId: string
): Promise<PortfolioContext> {
  const { data: allCompanies } = await admin
    .from('companies')
    .select('id, name, status, stage, industry')
    .eq('fund_id', fundId)

  const { data: allTransactions } = await admin
    .from('investment_transactions')
    .select('company_id, transaction_type, investment_cost, proceeds_received, proceeds_escrow, current_share_price, shares_acquired, unrealized_value_change')
    .eq('fund_id', fundId)

  let portfolioBlock = ''
  if (allCompanies && allTransactions) {
    const companySummaries: string[] = []
    for (const c of allCompanies) {
      const txns = allTransactions.filter(t => t.company_id === c.id)
      if (txns.length === 0) {
        companySummaries.push(`${c.name} (${c.status}): No investment data`)
        continue
      }

      let invested = 0
      let realized = 0
      let shares = 0
      let sharePrice = 0

      for (const t of txns) {
        if (t.transaction_type === 'investment') {
          invested += Number(t.investment_cost ?? 0)
          shares += Number(t.shares_acquired ?? 0)
        }
        if (t.transaction_type === 'proceeds') {
          realized += Number(t.proceeds_received ?? 0) + Number(t.proceeds_escrow ?? 0)
        }
        if (t.transaction_type === 'unrealized_gain_change' && t.current_share_price) {
          sharePrice = Number(t.current_share_price)
        }
      }

      const unrealized = shares > 0 && sharePrice > 0 ? shares * sharePrice : 0
      const fmv = realized + unrealized
      const moic = invested > 0 ? fmv / invested : null

      companySummaries.push(
        `${c.name} (${c.status}${c.stage ? `, ${c.stage}` : ''}): Invested ${invested.toLocaleString()}, FMV ${fmv.toLocaleString()}${moic ? `, MOIC ${moic.toFixed(2)}x` : ''}`
      )
    }
    if (companySummaries.length > 0) {
      portfolioBlock = companySummaries.join('\n')
    }
  }

  const systemPrompt = `You are a senior venture capital analyst at a growth-stage fund. You have access to portfolio-wide data. Answer questions about the overall portfolio, compare companies, and surface insights for the investment committee. Keep responses concise and analytical. Use plain text (no markdown formatting).`

  return { systemPrompt, portfolioBlock }
}

export interface CompanyContext {
  company: {
    id: string
    name: string
    fund_id: string
    stage: string | null
    industry: string[] | null
    notes: string | null
    overview: string | null
    why_invested: string | null
    current_update: string | null
  }
  currentPeriodLabel: string | null
  systemPrompt: string
  metricsBlock: string
  reportContentBlock: string
  previousSummariesBlock: string
  documentsBlock: string
  investmentBlock: string
  portfolioBlock: string
}

export async function buildCompanyContext(
  admin: Admin,
  companyId: string
): Promise<CompanyContext | null> {
  // --- Company ---
  const { data: company } = await admin
    .from('companies')
    .select('id, name, fund_id, stage, industry, notes, overview, why_invested, current_update')
    .eq('id', companyId)
    .maybeSingle()

  if (!company) return null

  // --- Metrics + values ---
  const { data: metrics } = await admin
    .from('metrics')
    .select('id, name, slug, unit, unit_position, value_type, reporting_cadence')
    .eq('company_id', companyId)
    .eq('is_active', true)
    .order('display_order')

  const { data: values } = await admin
    .from('metric_values')
    .select('metric_id, period_label, period_year, period_quarter, period_month, value_number, value_text')
    .eq('company_id', companyId)
    .order('period_year')
    .order('period_quarter', { nullsFirst: true })
    .order('period_month', { nullsFirst: true })

  // --- Latest email with report content ---
  const { data: latestEmail } = await admin
    .from('inbound_emails')
    .select('raw_payload, subject, received_at')
    .eq('company_id', companyId)
    .eq('processing_status', 'success')
    .order('received_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  // --- Company documents (uploaded context) ---
  const { data: companyDocuments } = await admin
    .from('company_documents' as any)
    .select('filename, extracted_text, has_native_content, storage_path, file_type')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(5) as { data: { filename: string; extracted_text: string | null; has_native_content: boolean; storage_path: string; file_type: string }[] | null }

  // --- Previous summaries ---
  const { data: previousSummaries } = await admin
    .from('company_summaries')
    .select('summary_text, period_label, created_at')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(3) as { data: { summary_text: string; period_label: string | null; created_at: string }[] | null }

  // --- Investment transactions ---
  const { data: transactions } = await admin
    .from('investment_transactions')
    .select('transaction_type, transaction_date, round_name, investment_cost, shares_acquired, share_price, proceeds_received, proceeds_escrow, current_share_price, unrealized_value_change, portfolio_group')
    .eq('company_id', companyId)
    .order('transaction_date', { ascending: true })

  // --- Portfolio-wide lightweight data ---
  const { data: allCompanies } = await admin
    .from('companies')
    .select('id, name, status')
    .eq('fund_id', company.fund_id)

  const { data: allTransactions } = await admin
    .from('investment_transactions')
    .select('company_id, transaction_type, investment_cost, proceeds_received, proceeds_escrow, current_share_price, shares_acquired, unrealized_value_change')
    .eq('fund_id', company.fund_id)

  // -----------------------------------------------------------------------
  // Build text blocks
  // -----------------------------------------------------------------------

  // 1. Metrics
  let metricsBlock = ''
  if (metrics && metrics.length > 0 && values && values.length > 0) {
    const lines: string[] = []
    for (const m of metrics) {
      const mValues = (values ?? []).filter(v => v.metric_id === m.id)
      if (mValues.length === 0) continue
      const unitStr = m.unit ? ` (${m.unit})` : ''
      lines.push(`\n${m.name}${unitStr}:`)
      for (const v of mValues) {
        const val = v.value_number !== null ? v.value_number : v.value_text
        lines.push(`  ${v.period_label}: ${val}`)
      }
    }
    metricsBlock = lines.join('\n')
  }

  // Determine most recent period label
  let currentPeriodLabel: string | null = null
  if (values && values.length > 0) {
    currentPeriodLabel = values[values.length - 1].period_label
  }

  // 2. Email body + attachment TEXT only (no binary)
  let reportContentBlock = ''
  if (latestEmail?.raw_payload) {
    const payload = await hydrateAttachments(latestEmail.raw_payload as unknown as PostmarkPayload)
    const extracted = await extractAttachmentText(payload)

    if (extracted.emailBody) {
      reportContentBlock += `[EMAIL BODY]\n${extracted.emailBody.slice(0, 30_000)}\n\n`
    }

    for (const att of extracted.attachments) {
      if (!att.skipped && att.extractedText) {
        reportContentBlock += `[ATTACHMENT: ${att.filename}]\n${att.extractedText.slice(0, 30_000)}\n\n`
      }
    }
  }

  // 3. Previous summaries
  let previousSummariesBlock = ''
  if (previousSummaries && previousSummaries.length > 0) {
    previousSummariesBlock = previousSummaries
      .reverse()
      .map(s => `[${s.period_label ?? 'Unknown period'} — ${new Date(s.created_at).toLocaleDateString()}]\n${s.summary_text}`)
      .join('\n\n')
  }

  // 4. Documents (text only — skip binary PDFs/images for analyst)
  let documentsBlock = ''
  if (companyDocuments && companyDocuments.length > 0) {
    for (const doc of companyDocuments) {
      if (doc.extracted_text) {
        documentsBlock += `[DOCUMENT: ${doc.filename}]\n${doc.extracted_text.slice(0, 30_000)}\n\n`
      }
    }
  }

  // 5. Investment summary
  let investmentBlock = ''
  if (transactions && transactions.length > 0) {
    let totalInvested = 0
    let totalShares = 0
    let totalRealized = 0
    let latestSharePrice = 0

    for (const t of transactions) {
      if (t.transaction_type === 'investment') {
        totalInvested += Number(t.investment_cost ?? 0)
        totalShares += Number(t.shares_acquired ?? 0)
      }
      if (t.transaction_type === 'proceeds') {
        totalRealized += Number(t.proceeds_received ?? 0) + Number(t.proceeds_escrow ?? 0)
      }
      if (t.transaction_type === 'unrealized_gain_change' && t.current_share_price) {
        latestSharePrice = Number(t.current_share_price)
      }
      if (t.transaction_type === 'round_info' && t.share_price) {
        latestSharePrice = Number(t.share_price)
      }
    }

    const unrealizedValue = totalShares > 0 && latestSharePrice > 0 ? totalShares * latestSharePrice : 0
    const fmv = totalRealized + unrealizedValue
    const moic = totalInvested > 0 ? fmv / totalInvested : null

    const lines: string[] = []
    lines.push(`Total Invested: ${totalInvested.toLocaleString()}`)
    if (totalRealized > 0) lines.push(`Total Realized: ${totalRealized.toLocaleString()}`)
    if (unrealizedValue > 0) lines.push(`Unrealized Value: ${unrealizedValue.toLocaleString()}`)
    lines.push(`Fair Market Value: ${fmv.toLocaleString()}`)
    if (moic !== null) lines.push(`MOIC: ${moic.toFixed(2)}x`)

    // Round breakdown
    const rounds = new Map<string, { invested: number; shares: number }>()
    for (const t of transactions) {
      if (t.transaction_type === 'investment' && t.round_name) {
        const r = rounds.get(t.round_name) ?? { invested: 0, shares: 0 }
        r.invested += Number(t.investment_cost ?? 0)
        r.shares += Number(t.shares_acquired ?? 0)
        rounds.set(t.round_name, r)
      }
    }
    if (rounds.size > 0) {
      lines.push('\nRounds:')
      rounds.forEach((r, name) => {
        lines.push(`  ${name}: ${r.invested.toLocaleString()} invested`)
      })
    }

    investmentBlock = lines.join('\n')
  }

  // 6. Portfolio comparison (lightweight)
  let portfolioBlock = ''
  if (allCompanies && allTransactions) {
    const companySummaries: string[] = []
    for (const c of allCompanies) {
      if (c.id === companyId) continue
      const txns = allTransactions.filter(t => t.company_id === c.id)
      if (txns.length === 0) continue

      let invested = 0
      let realized = 0
      let shares = 0
      let sharePrice = 0

      for (const t of txns) {
        if (t.transaction_type === 'investment') {
          invested += Number(t.investment_cost ?? 0)
          shares += Number(t.shares_acquired ?? 0)
        }
        if (t.transaction_type === 'proceeds') {
          realized += Number(t.proceeds_received ?? 0) + Number(t.proceeds_escrow ?? 0)
        }
        if (t.transaction_type === 'unrealized_gain_change' && t.current_share_price) {
          sharePrice = Number(t.current_share_price)
        }
      }

      const unrealized = shares > 0 && sharePrice > 0 ? shares * sharePrice : 0
      const fmv = realized + unrealized
      const moic = invested > 0 ? fmv / invested : null

      companySummaries.push(
        `${c.name} (${c.status}): Invested ${invested.toLocaleString()}, FMV ${fmv.toLocaleString()}${moic ? `, MOIC ${moic.toFixed(2)}x` : ''}`
      )
    }
    if (companySummaries.length > 0) {
      portfolioBlock = companySummaries.join('\n')
    }
  }

  // System prompt
  const systemPrompt = `You are a senior venture capital analyst at a growth-stage fund preparing an internal portfolio review memo for the investment committee. You think in terms of unit economics, growth efficiency, cash runway, and milestone progress. Your job is to surface what matters for the next board conversation and flag anything that warrants immediate attention.

Company: ${company.name}
${company.stage ? `Stage: ${company.stage}` : ''}
${company.industry?.length ? `Industry: ${company.industry.join(', ')}` : ''}
${company.notes ? `Fund notes: ${company.notes}` : ''}
${company.overview ? `Overview: ${company.overview}` : ''}
${company.why_invested ? `Why We Invested: ${company.why_invested}` : ''}
${company.current_update ? `Current Business Update: ${company.current_update}` : ''}`

  return {
    company,
    currentPeriodLabel,
    systemPrompt,
    metricsBlock,
    reportContentBlock,
    previousSummariesBlock,
    documentsBlock,
    investmentBlock,
    portfolioBlock,
  }
}
