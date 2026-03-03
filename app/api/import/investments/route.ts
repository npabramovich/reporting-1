import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertWriteAccess } from '@/lib/api-helpers'
import { createFundAIProvider } from '@/lib/ai'
import { logAIUsage } from '@/lib/ai/usage'
import { logActivity } from '@/lib/activity'
import { rateLimit } from '@/lib/rate-limit'

interface ParsedTransaction {
  company_name: string
  company_status?: 'active' | 'exited' | 'written-off'
  transaction_type: 'investment' | 'proceeds' | 'unrealized_gain_change'
  round_name?: string
  transaction_date?: string
  notes?: string
  investment_cost?: number
  interest_converted?: number
  shares_acquired?: number
  share_price?: number
  cost_basis_exited?: number
  proceeds_received?: number
  proceeds_escrow?: number
  proceeds_written_off?: number
  proceeds_per_share?: number
  unrealized_value_change?: number
  current_share_price?: number
}

const VALID_TYPES = new Set(['investment', 'proceeds', 'unrealized_gain_change'])

function sanitize(val: string): string {
  return val
    .replace(/<[^>]*>/g, '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .trim()
    .slice(0, 10_000)
}

// ---------------------------------------------------------------------------
// POST — bulk import investment transactions via AI parsing
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const writeCheck = await assertWriteAccess(createAdminClient(), user.id)
  if (writeCheck instanceof NextResponse) return writeCheck

  const limited = await rateLimit({ key: `import-investments:${user.id}`, limit: 10, windowSeconds: 300 })
  if (limited) return limited

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

  if (typeof text !== 'string' || !text.trim()) {
    return NextResponse.json({ error: 'No text provided' }, { status: 400 })
  }

  if (text.length > 500_000) {
    return NextResponse.json({ error: 'Input too large. Maximum 500KB of text allowed.' }, { status: 400 })
  }

  // Get AI provider
  let provider: Awaited<ReturnType<typeof createFundAIProvider>>['provider']
  let claudeModel: string
  let aiProviderType: 'anthropic' | 'openai'
  try {
    const result = await createFundAIProvider(admin, fundId)
    provider = result.provider
    claudeModel = result.model
    aiProviderType = result.providerType
  } catch {
    return NextResponse.json({ error: 'AI API key not configured. Add one in Settings.' }, { status: 400 })
  }

  let responseText: string
  try {
    const aiResult = await provider.createMessage({
      model: claudeModel,
      maxTokens: 8192,
      content: `Parse the following investment data (CSV, spreadsheet, or free-form text) into structured JSON.

Return ONLY valid JSON in this exact format (no markdown, no explanation):
{
  "transactions": [
    {
      "company_name": "Company Name",
      "company_status": "active",
      "transaction_type": "investment",
      "round_name": "Series A",
      "transaction_date": "2024-01-15",
      "investment_cost": 500000,
      "interest_converted": 0,
      "shares_acquired": 50000,
      "share_price": 10.00
    },
    {
      "company_name": "Company Name",
      "company_status": "exited",
      "transaction_type": "proceeds",
      "round_name": "Exit",
      "transaction_date": "2025-06-01",
      "cost_basis_exited": 500000,
      "proceeds_received": 1500000,
      "proceeds_escrow": 100000,
      "proceeds_written_off": 0,
      "proceeds_per_share": 30.00
    },
    {
      "company_name": "Company Name",
      "company_status": "active",
      "transaction_type": "unrealized_gain_change",
      "round_name": "Series B",
      "transaction_date": "2025-12-31",
      "unrealized_value_change": 200000,
      "current_share_price": 14.00
    }
  ]
}

Rules:
- transaction_type must be one of: "investment", "proceeds", "unrealized_gain_change"
- company_status must be one of: "active", "exited", "written-off". Infer from context: if there are proceeds/exit transactions, use "exited"; if marked as written off or loss, use "written-off"; otherwise default to "active"
- Dates should be in YYYY-MM-DD format
- All monetary values should be plain numbers (no currency symbols)
- For investment rows: include investment_cost, shares_acquired, share_price, and optionally interest_converted
- For proceeds rows: include proceeds_received, and optionally cost_basis_exited, proceeds_escrow, proceeds_written_off, proceeds_per_share
- For unrealized_gain_change rows: include current_share_price, and optionally unrealized_value_change
- Use the company name exactly as it appears in the data
- If the data has column headers like "Cost", "Amount Invested", "Investment Amount" those map to investment_cost
- "Shares", "# Shares" maps to shares_acquired
- "Price/Share", "Share Price" maps to share_price
- "Proceeds", "Exit Proceeds", "Amount Received" maps to proceeds_received
- If the data describes valuations or current fair market value, create unrealized_gain_change entries
- If you can't determine the transaction type, default to "investment"

Data to parse:
${text}`,
    })
    responseText = aiResult.text

    logAIUsage(admin, {
      fundId,
      userId: user.id,
      provider: aiProviderType,
      model: claudeModel,
      feature: 'import.investments',
      usage: aiResult.usage,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[import-investments] AI API error:', message)
    return NextResponse.json({ error: `AI API call failed: ${message}` }, { status: 500 })
  }

  let parsed: { transactions: ParsedTransaction[] }
  try {
    const jsonMatch = responseText.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('No JSON found in response')
    parsed = JSON.parse(jsonMatch[0])
  } catch {
    return NextResponse.json({
      error: 'Failed to parse AI response as JSON',
      raw: responseText,
    }, { status: 500 })
  }

  if (!parsed.transactions || !Array.isArray(parsed.transactions)) {
    return NextResponse.json({ error: 'Invalid response structure' }, { status: 500 })
  }

  if (parsed.transactions.length > 5000) {
    return NextResponse.json({ error: 'Too many transactions in parsed result (max 5000)' }, { status: 400 })
  }

  // Get existing companies for matching
  const { data: existingCompanies } = await admin
    .from('companies')
    .select('id, name')
    .eq('fund_id', fundId)

  const companyByName = new Map(
    (existingCompanies ?? []).map(c => [c.name.toLowerCase(), c.id])
  )

  const results = {
    investmentsCreated: 0,
    proceedsCreated: 0,
    unrealizedCreated: 0,
    companiesMatched: 0,
    companiesCreated: 0,
    errors: [] as string[],
  }

  const matchedCompanies = new Set<string>()

  for (const pt of parsed.transactions) {
    if (!pt.company_name || typeof pt.company_name !== 'string' || !pt.company_name.trim()) {
      results.errors.push('Skipped transaction with no company name')
      continue
    }

    const companyName = sanitize(pt.company_name)
    if (!companyName) {
      results.errors.push('Skipped transaction with empty company name after sanitization')
      continue
    }

    let companyId = companyByName.get(companyName.toLowerCase())
    if (!companyId) {
      // Auto-create the company
      const status = (['active', 'exited', 'written-off'] as const).includes(pt.company_status as any)
        ? pt.company_status!
        : 'active'
      const { data: newCompany, error: companyError } = await admin
        .from('companies')
        .insert({
          fund_id: fundId,
          name: companyName,
          status,
          tags: [],
        })
        .select('id')
        .single()

      if (companyError || !newCompany) {
        results.errors.push(`Failed to create company "${companyName}": ${companyError?.message}`)
        continue
      }

      companyId = newCompany.id
      companyByName.set(companyName.toLowerCase(), companyId)
      results.companiesCreated++
    }

    if (!matchedCompanies.has(companyId)) {
      matchedCompanies.add(companyId)
      results.companiesMatched++
    }

    const txnType = pt.transaction_type
    if (!txnType || !VALID_TYPES.has(txnType)) {
      results.errors.push(`Invalid transaction type "${txnType}" for "${companyName}"`)
      continue
    }

    const { error: insertError } = await admin
      .from('investment_transactions' as any)
      .insert({
        company_id: companyId,
        fund_id: fundId,
        transaction_type: txnType,
        round_name: pt.round_name ? sanitize(pt.round_name) : null,
        transaction_date: pt.transaction_date || null,
        notes: pt.notes ? sanitize(pt.notes) : null,
        investment_cost: pt.investment_cost ?? null,
        interest_converted: pt.interest_converted ?? 0,
        shares_acquired: pt.shares_acquired ?? null,
        share_price: pt.share_price ?? null,
        cost_basis_exited: pt.cost_basis_exited ?? null,
        proceeds_received: pt.proceeds_received ?? null,
        proceeds_escrow: pt.proceeds_escrow ?? 0,
        proceeds_written_off: pt.proceeds_written_off ?? 0,
        proceeds_per_share: pt.proceeds_per_share ?? null,
        unrealized_value_change: pt.unrealized_value_change ?? null,
        current_share_price: pt.current_share_price ?? null,
      })

    if (insertError) {
      results.errors.push(`Failed to insert ${txnType} for "${companyName}": ${insertError.message}`)
      continue
    }

    if (txnType === 'investment') results.investmentsCreated++
    else if (txnType === 'proceeds') results.proceedsCreated++
    else results.unrealizedCreated++
  }

  logActivity(admin, fundId, user.id, 'import.investments', {
    investmentsCreated: results.investmentsCreated,
    proceedsCreated: results.proceedsCreated,
    unrealizedCreated: results.unrealizedCreated,
    companiesCreated: results.companiesCreated,
    companiesMatched: results.companiesMatched,
  })

  return NextResponse.json(results)
}
