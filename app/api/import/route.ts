import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getClaudeApiKey, getClaudeModel } from '@/lib/pipeline/processEmail'
import Anthropic from '@anthropic-ai/sdk'

interface ParsedMetric {
  name: string
  unit?: string
  unit_position?: 'prefix' | 'suffix'
  value_type?: 'number' | 'currency' | 'percentage' | 'text'
  cadence?: 'monthly' | 'quarterly' | 'annual'
  historical_values?: Array<{
    period: string
    value: number | string
  }>
}

interface ParsedCompany {
  name: string
  tags?: string[]
  sender_emails?: string[]
  summary?: string
  stage?: string
  sector?: string
  metrics?: ParsedMetric[]
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
}

function parsePeriodLabel(period: string): {
  label: string
  year: number
  quarter: number | null
  month: number | null
} {
  const label = period.trim()

  // Try Q1 2025 format
  const qMatch = label.match(/Q(\d)\s+(\d{4})/)
  if (qMatch) {
    return {
      label,
      year: parseInt(qMatch[2]),
      quarter: parseInt(qMatch[1]),
      month: null,
    }
  }

  // Try month name + year (e.g. "January 2025", "Jan 2025")
  const months = [
    'january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december',
  ]
  const monthAbbrs = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

  for (let i = 0; i < months.length; i++) {
    const re = new RegExp(`(?:${months[i]}|${monthAbbrs[i]})\\s+(\\d{4})`, 'i')
    const m = label.match(re)
    if (m) {
      return {
        label,
        year: parseInt(m[1]),
        quarter: null,
        month: i + 1,
      }
    }
  }

  // Try year only
  const yearMatch = label.match(/^(\d{4})$/)
  if (yearMatch) {
    return { label, year: parseInt(yearMatch[1]), quarter: null, month: null }
  }

  // Fallback
  return { label, year: new Date().getFullYear(), quarter: null, month: null }
}

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  const { data: membership } = await admin
    .from('fund_members')
    .select('fund_id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!membership) return NextResponse.json({ error: 'No fund found' }, { status: 403 })

  const fundId = membership.fund_id
  const body = await req.json()
  const { text } = body

  if (!text?.trim()) {
    return NextResponse.json({ error: 'No text provided' }, { status: 400 })
  }

  // Get Claude API key + model
  let claudeApiKey: string
  try {
    claudeApiKey = await getClaudeApiKey(admin, fundId)
  } catch {
    return NextResponse.json({ error: 'Claude API key not configured. Add one in Settings.' }, { status: 400 })
  }
  const claudeModel = await getClaudeModel(admin, fundId)

  // Parse with Claude
  const anthropic = new Anthropic({ apiKey: claudeApiKey })

  let responseText: string
  try {
    const parseResponse = await anthropic.messages.create({
      model: claudeModel,
      max_tokens: 8192,
      messages: [{
        role: 'user',
        content: `Parse the following spreadsheet/CSV data into structured JSON. Extract companies with their details and metrics.

Return ONLY valid JSON in this exact format (no markdown, no explanation):
{
  "companies": [
    {
      "name": "Company Name",
      "tags": ["Fund I"],
      "sender_emails": ["email@example.com"],
      "summary": "Brief business description",
      "stage": "Series A",
      "sector": "SaaS",
      "metrics": [
        {
          "name": "MRR",
          "unit": "$",
          "unit_position": "prefix",
          "value_type": "currency",
          "cadence": "monthly",
          "historical_values": [
            { "period": "Q1 2025", "value": 50000 }
          ]
        }
      ]
    }
  ]
}

Rules:
- Each row likely represents a company
- Look for columns like: company name, fund, email, sector, stage, description/summary
- Look for metric columns with values (revenue, MRR, ARR, headcount, burn rate, etc.)
- The "fund" column maps to tags (e.g. "Fund I", "Fund II")
- value_type: use "currency" for dollar amounts, "percentage" for percentages, "number" for counts
- unit_position: "prefix" for currency ($), "suffix" for percent (%)
- If a column header looks like a period (Q1 2025, Jan 2025, 2024), those are historical metric values
- Infer the metric name from the row label or column group header
- If you can't parse something, skip it rather than guessing wrong

Data to parse:
${text}`,
      }],
    })

    responseText = parseResponse.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map(b => b.text)
      .join('')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[import] Claude API error:', message)
    return NextResponse.json({
      error: `Claude API call failed: ${message}`,
    }, { status: 500 })
  }

  let parsed: { companies: ParsedCompany[] }
  try {
    // Try to extract JSON from the response (handle possible markdown wrapping)
    const jsonMatch = responseText.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('No JSON found in response')
    parsed = JSON.parse(jsonMatch[0])
  } catch {
    return NextResponse.json({
      error: 'Failed to parse Claude response as JSON',
      raw: responseText,
    }, { status: 500 })
  }

  if (!parsed.companies || !Array.isArray(parsed.companies)) {
    return NextResponse.json({ error: 'Invalid response structure' }, { status: 500 })
  }

  // Get existing companies for matching
  const { data: existingCompanies } = await admin
    .from('companies')
    .select('id, name')
    .eq('fund_id', fundId)

  const companyByName = new Map(
    (existingCompanies ?? []).map(c => [c.name.toLowerCase(), c.id])
  )

  // Get existing senders for dedup
  const { data: existingSenders } = await admin
    .from('authorized_senders')
    .select('email')
    .eq('fund_id', fundId)
  const existingSenderEmails = new Set(
    (existingSenders ?? []).map(s => (s.email as string).toLowerCase())
  )

  const results = {
    companiesCreated: 0,
    companiesMatched: 0,
    metricsCreated: 0,
    metricsMatched: 0,
    metricValuesCreated: 0,
    metricValuesSkipped: 0,
    sendersCreated: 0,
    errors: [] as string[],
  }

  for (const pc of parsed.companies) {
    if (!pc.name?.trim()) {
      results.errors.push('Skipped company with no name')
      continue
    }

    const companyName = pc.name.trim()
    let companyId = companyByName.get(companyName.toLowerCase())

    if (companyId) {
      // Company already exists — use it
      results.companiesMatched++
    } else {
      // Create company
      const { data: newCompany, error: companyError } = await admin
        .from('companies')
        .insert({
          fund_id: fundId,
          name: companyName,
          tags: pc.tags ?? [],
          stage: pc.stage?.trim() || null,
          sector: pc.sector?.trim() || null,
          notes: pc.summary?.trim() || null,
          status: 'active',
        })
        .select('id')
        .single()

      if (companyError || !newCompany) {
        results.errors.push(`Failed to create company "${companyName}": ${companyError?.message}`)
        continue
      }

      companyId = newCompany.id
      results.companiesCreated++
      companyByName.set(companyName.toLowerCase(), companyId)
    }

    // Create authorized senders (skip duplicates)
    if (pc.sender_emails?.length) {
      for (const email of pc.sender_emails) {
        const trimmedEmail = email.trim().toLowerCase()
        if (!trimmedEmail || existingSenderEmails.has(trimmedEmail)) continue

        const { error: senderError } = await admin
          .from('authorized_senders')
          .insert({
            fund_id: fundId,
            email: trimmedEmail,
            label: companyName,
          })

        if (!senderError) {
          results.sendersCreated++
          existingSenderEmails.add(trimmedEmail)
        }
      }
    }

    // Get existing metrics for this company to avoid duplicates
    const { data: existingMetrics } = await admin
      .from('metrics')
      .select('id, slug')
      .eq('company_id', companyId)

    const metricBySlug = new Map(
      (existingMetrics ?? []).map(m => [m.slug as string, m.id as string])
    )

    // Create metrics and historical values
    if (pc.metrics?.length) {
      const nextOrder = (existingMetrics ?? []).length

      for (let i = 0; i < pc.metrics.length; i++) {
        const m = pc.metrics[i]
        if (!m.name?.trim()) continue

        const slug = slugify(m.name)
        let metricId = metricBySlug.get(slug)

        if (metricId) {
          // Metric already exists — reuse it for values
          results.metricsMatched++
        } else {
          const { data: newMetric, error: metricError } = await admin
            .from('metrics')
            .insert({
              company_id: companyId,
              fund_id: fundId,
              name: m.name.trim(),
              slug,
              unit: m.unit || null,
              unit_position: m.unit_position || 'prefix',
              value_type: m.value_type || 'number',
              reporting_cadence: m.cadence || 'quarterly',
              display_order: nextOrder + i,
              is_active: true,
            })
            .select('id')
            .single()

          if (metricError || !newMetric) {
            results.errors.push(`Failed to create metric "${m.name}" for "${companyName}": ${metricError?.message}`)
            continue
          }

          metricId = newMetric.id
          results.metricsCreated++
          metricBySlug.set(slug, metricId)
        }

        // Create historical values (upsert — skip if period already exists)
        if (m.historical_values?.length) {
          for (const hv of m.historical_values) {
            const period = parsePeriodLabel(hv.period)
            const valueNum = typeof hv.value === 'number' ? hv.value : parseFloat(String(hv.value).replace(/[^0-9.-]/g, ''))

            // Check if value already exists for this metric + period
            let existingQuery = admin
              .from('metric_values')
              .select('id')
              .eq('metric_id', metricId)
              .eq('period_year', period.year)

            existingQuery = period.quarter != null
              ? existingQuery.eq('period_quarter', period.quarter)
              : existingQuery.is('period_quarter', null)

            existingQuery = period.month != null
              ? existingQuery.eq('period_month', period.month)
              : existingQuery.is('period_month', null)

            const { data: existingVal } = await existingQuery.maybeSingle()

            if (existingVal) {
              results.metricValuesSkipped++
              continue
            }

            const { error: valError } = await admin
              .from('metric_values')
              .insert({
                metric_id: metricId,
                company_id: companyId,
                fund_id: fundId,
                period_label: period.label,
                period_year: period.year,
                period_quarter: period.quarter,
                period_month: period.month,
                value_number: isNaN(valueNum) ? null : valueNum,
                value_text: isNaN(valueNum) ? String(hv.value) : null,
                confidence: 'high',
                is_manually_entered: true,
              })

            if (!valError) results.metricValuesCreated++
          }
        }
      }
    }
  }

  return NextResponse.json(results)
}
