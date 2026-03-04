import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertWriteAccess } from '@/lib/api-helpers'
import { dbError } from '@/lib/api-error'
import { logActivity } from '@/lib/activity'
import type { InvestmentTransaction, CompanyStatus } from '@/lib/types/database'
import type { CompanyInvestmentSummary, InvestmentRoundSummary } from '@/lib/types/investments'

// ---------------------------------------------------------------------------
// Compute summary from raw transactions
// ---------------------------------------------------------------------------

function computeSummary(
  transactions: InvestmentTransaction[],
  companyStatus: CompanyStatus
): CompanyInvestmentSummary {
  let totalInvested = 0
  let totalShares = 0
  let totalRealized = 0
  let totalWrittenOff = 0
  let latestSharePrice: number | null = null
  let latestSharePriceDate: string | null = null

  const roundMap = new Map<string, InvestmentRoundSummary>()

  for (const txn of transactions) {
    if (txn.transaction_type === 'investment') {
      totalInvested += txn.investment_cost ?? 0
      totalShares += txn.shares_acquired ?? 0

      const roundName = txn.round_name ?? 'Unknown'
      const existing = roundMap.get(roundName)
      if (existing) {
        existing.investmentCost += txn.investment_cost ?? 0
        existing.sharesAcquired += txn.shares_acquired ?? 0
        existing.interestConverted += txn.interest_converted ?? 0
        if (!existing.date && txn.transaction_date) existing.date = txn.transaction_date
        if (txn.share_price != null) existing.sharePrice = txn.share_price
      } else {
        roundMap.set(roundName, {
          roundName,
          date: txn.transaction_date,
          investmentCost: txn.investment_cost ?? 0,
          sharesAcquired: txn.shares_acquired ?? 0,
          sharePrice: txn.share_price,
          currentSharePrice: null,
          currentValue: 0,
          interestConverted: txn.interest_converted ?? 0,
          unrealizedValueChange: 0,
          costBasisExited: 0,
        })
      }
    }

    if (txn.transaction_type === 'proceeds') {
      totalRealized += (txn.proceeds_received ?? 0) + (txn.proceeds_escrow ?? 0)
      totalWrittenOff += txn.proceeds_written_off ?? 0
      // Attribute cost basis exited to the round if specified
      if (txn.round_name && txn.cost_basis_exited != null) {
        const round = roundMap.get(txn.round_name)
        if (round) round.costBasisExited += txn.cost_basis_exited
      }
    }

    if (txn.transaction_type === 'unrealized_gain_change') {
      if (txn.current_share_price != null && txn.transaction_date) {
        if (!latestSharePriceDate || txn.transaction_date > latestSharePriceDate) {
          latestSharePrice = txn.current_share_price
          latestSharePriceDate = txn.transaction_date
        }
      }
      // Attribute unrealized value change to the round if specified
      if (txn.round_name && txn.unrealized_value_change != null) {
        const round = roundMap.get(txn.round_name)
        if (round) round.unrealizedValueChange += txn.unrealized_value_change
      }
    }
  }

  // Compute per-round FMV and sum for company unrealized value
  const rounds = Array.from(roundMap.values())
  let unrealizedValue = 0
  for (const round of rounds) {
    round.currentSharePrice = latestSharePrice
    if (round.sharesAcquired > 0) {
      // Equity round: shares * current share price
      round.currentValue = latestSharePrice != null ? round.sharesAcquired * latestSharePrice : 0
    } else {
      // Convertible / no shares: investment cost - cost basis exited + unrealized changes
      round.currentValue = round.investmentCost - round.costBasisExited + round.unrealizedValueChange
    }
    unrealizedValue += round.currentValue
  }

  let fmv: number
  if (companyStatus === 'exited') {
    fmv = totalRealized
  } else if (companyStatus === 'written-off') {
    fmv = 0
  } else {
    fmv = unrealizedValue
  }

  const moic = totalInvested > 0 ? (totalRealized + unrealizedValue) / totalInvested : null

  return {
    totalInvested,
    totalShares,
    totalRealized,
    totalWrittenOff,
    latestSharePrice,
    unrealizedValue,
    fmv,
    moic,
    rounds,
  }
}

// ---------------------------------------------------------------------------
// GET — all transactions for a company + computed summary
// ---------------------------------------------------------------------------

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  // Verify company exists and user has access
  const { data: company } = await admin
    .from('companies')
    .select('id, fund_id, status')
    .eq('id', params.id)
    .maybeSingle()

  if (!company) return NextResponse.json({ error: 'Company not found' }, { status: 404 })

  const { data: membership } = await supabase
    .from('fund_members')
    .select('role')
    .eq('fund_id', company.fund_id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!membership) return NextResponse.json({ error: 'Not a fund member' }, { status: 403 })

  const { data: transactions, error } = await admin
    .from('investment_transactions' as any)
    .select('*')
    .eq('company_id', params.id)
    .order('transaction_date', { ascending: true }) as { data: InvestmentTransaction[] | null; error: { message: string } | null }

  if (error) return dbError(error, 'companies-id-investments')

  const txns = (transactions ?? []) as InvestmentTransaction[]
  const summary = computeSummary(txns, company.status as CompanyStatus)

  return NextResponse.json({ transactions: txns, summary })
}

// ---------------------------------------------------------------------------
// POST — create a new transaction
// ---------------------------------------------------------------------------

const VALID_TYPES = ['investment', 'proceeds', 'unrealized_gain_change']

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  const writeCheck = await assertWriteAccess(admin, user.id)
  if (writeCheck instanceof NextResponse) return writeCheck

  // Verify company exists
  const { data: company } = await admin
    .from('companies')
    .select('id, fund_id')
    .eq('id', params.id)
    .maybeSingle()

  if (!company) return NextResponse.json({ error: 'Company not found' }, { status: 404 })

  const { data: membership } = await supabase
    .from('fund_members')
    .select('role')
    .eq('fund_id', company.fund_id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!membership) return NextResponse.json({ error: 'Not a fund member' }, { status: 403 })

  const body = await req.json()
  const { transaction_type } = body

  if (!transaction_type || !VALID_TYPES.includes(transaction_type)) {
    return NextResponse.json({ error: 'Invalid transaction_type' }, { status: 400 })
  }

  const { data: txn, error } = await admin
    .from('investment_transactions' as any)
    .insert({
      company_id: params.id,
      fund_id: company.fund_id,
      transaction_type: body.transaction_type,
      round_name: body.round_name ?? null,
      transaction_date: body.transaction_date ?? null,
      notes: body.notes ?? null,
      investment_cost: body.investment_cost ?? null,
      interest_converted: body.interest_converted ?? 0,
      shares_acquired: body.shares_acquired ?? null,
      share_price: body.share_price ?? null,
      cost_basis_exited: body.cost_basis_exited ?? null,
      proceeds_received: body.proceeds_received ?? null,
      proceeds_escrow: body.proceeds_escrow ?? 0,
      proceeds_written_off: body.proceeds_written_off ?? 0,
      proceeds_per_share: body.proceeds_per_share ?? null,
      unrealized_value_change: body.unrealized_value_change ?? null,
      current_share_price: body.current_share_price ?? null,
      postmoney_valuation: body.postmoney_valuation ?? null,
      latest_postmoney_valuation: body.latest_postmoney_valuation ?? null,
      exit_valuation: body.exit_valuation ?? null,
      original_currency: body.original_currency ?? null,
      original_investment_cost: body.original_investment_cost ?? null,
      original_share_price: body.original_share_price ?? null,
      original_postmoney_valuation: body.original_postmoney_valuation ?? null,
      original_proceeds_received: body.original_proceeds_received ?? null,
      original_proceeds_per_share: body.original_proceeds_per_share ?? null,
      original_exit_valuation: body.original_exit_valuation ?? null,
      original_unrealized_value_change: body.original_unrealized_value_change ?? null,
      original_current_share_price: body.original_current_share_price ?? null,
      original_latest_postmoney_valuation: body.original_latest_postmoney_valuation ?? null,
    })
    .select('*')
    .single() as { data: InvestmentTransaction | null; error: { message: string } | null }

  if (error) return dbError(error, 'companies-id-investments-post')

  logActivity(admin, company.fund_id, user.id, 'investment.create', {
    companyId: params.id,
    transactionType: transaction_type,
  })

  return NextResponse.json(txn)
}
