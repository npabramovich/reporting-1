import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { dbError } from '@/lib/api-error'
import type { InvestmentTransaction, CompanyStatus } from '@/lib/types/database'

// ---------------------------------------------------------------------------
// XIRR — Newton-Raphson method
// ---------------------------------------------------------------------------

interface CashFlow {
  date: Date
  amount: number
}

function xirr(flows: CashFlow[]): number | null {
  if (flows.length < 2) return null

  // Need at least one positive and one negative cash flow
  const hasPos = flows.some(f => f.amount > 0)
  const hasNeg = flows.some(f => f.amount < 0)
  if (!hasPos || !hasNeg) return null

  const daysFromFirst = flows.map(f => (f.date.getTime() - flows[0].date.getTime()) / (365.25 * 86400000))

  function npv(rate: number): number {
    return flows.reduce((sum, f, i) => sum + f.amount / Math.pow(1 + rate, daysFromFirst[i]), 0)
  }

  function dnpv(rate: number): number {
    return flows.reduce((sum, f, i) => {
      const t = daysFromFirst[i]
      return sum - t * f.amount / Math.pow(1 + rate, t + 1)
    }, 0)
  }

  let rate = 0.1
  for (let iter = 0; iter < 100; iter++) {
    const val = npv(rate)
    const deriv = dnpv(rate)
    if (Math.abs(deriv) < 1e-12) break
    const next = rate - val / deriv
    if (Math.abs(next - rate) < 1e-8) return next
    rate = next
    // Guard against divergence
    if (rate < -0.999 || rate > 100) return null
  }
  return Math.abs(npv(rate)) < 1 ? rate : null
}

// ---------------------------------------------------------------------------
// GET — portfolio-wide investment summary
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  const { data: membership } = await admin
    .from('fund_members')
    .select('fund_id, role')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!membership) return NextResponse.json({ error: 'No fund found' }, { status: 403 })

  const fundId = membership.fund_id

  // Fetch transactions for this fund, optionally filtered by as-of date
  const asOf = req.nextUrl.searchParams.get('asOf')

  let txnQuery = admin
    .from('investment_transactions' as any)
    .select('*')
    .eq('fund_id', fundId)

  if (asOf) {
    txnQuery = txnQuery.lte('transaction_date', asOf)
  }

  const { data: transactions, error: txnError } = await txnQuery
    .order('transaction_date', { ascending: true }) as { data: InvestmentTransaction[] | null; error: { message: string } | null }

  if (txnError) return dbError(txnError, 'portfolio-investments')

  // Fetch companies for names, statuses, and portfolio groups
  const { data: companies, error: compError } = await admin
    .from('companies')
    .select('id, name, status, portfolio_group')
    .eq('fund_id', fundId) as { data: { id: string; name: string; status: CompanyStatus; portfolio_group: string[] | null }[] | null; error: { message: string } | null }

  if (compError) return dbError(compError, 'portfolio-investments-companies')

  const companyMap = new Map((companies ?? []).map(c => [c.id, c]))

  // Group transactions by company
  const byCompany = new Map<string, InvestmentTransaction[]>()
  for (const txn of transactions ?? []) {
    const list = byCompany.get(txn.company_id) ?? []
    list.push(txn)
    byCompany.set(txn.company_id, list)
  }

  let portfolioInvested = 0
  let portfolioRealized = 0
  let portfolioUnrealized = 0
  let portfolioFMV = 0

  // Collect all cash flows for portfolio-level IRR
  const allCashFlows: CashFlow[] = []
  const asOfDate = asOf ? new Date(asOf) : new Date()

  const companySummaries: {
    companyId: string
    companyName: string
    status: CompanyStatus
    portfolioGroup: string[]
    totalInvested: number
    totalRealized: number
    unrealizedValue: number
    fmv: number
    moic: number | null
    irr: number | null
  }[] = []

  for (const [companyId, txns] of Array.from(byCompany.entries())) {
    const company = companyMap.get(companyId)
    if (!company) continue

    const companyDefaultGroup = company.portfolio_group?.[0] ?? ''

    // First pass: determine company-wide latestSharePrice from unrealized_gain_change and round_info
    let latestSharePrice: number | null = null
    let latestSharePriceDate: string | null = null

    for (const txn of txns) {
      if (txn.transaction_type === 'unrealized_gain_change') {
        if (txn.current_share_price != null && txn.transaction_date) {
          if (!latestSharePriceDate || txn.transaction_date > latestSharePriceDate) {
            latestSharePrice = txn.current_share_price
            latestSharePriceDate = txn.transaction_date
          }
        }
      }
      if (txn.transaction_type === 'round_info') {
        if (txn.share_price != null && txn.transaction_date) {
          if (!latestSharePriceDate || txn.transaction_date > latestSharePriceDate) {
            latestSharePrice = txn.share_price
            latestSharePriceDate = txn.transaction_date
          }
        }
      }
    }

    // Second pass: group investment and proceeds transactions by portfolio_group
    const groupTxns = new Map<string, InvestmentTransaction[]>()
    for (const txn of txns) {
      if (txn.transaction_type === 'investment' || txn.transaction_type === 'proceeds') {
        const group = txn.portfolio_group ?? companyDefaultGroup
        const list = groupTxns.get(group) ?? []
        list.push(txn)
        groupTxns.set(group, list)
      }
      // Also bucket unrealized_gain_change with round attribution to the correct group
      if (txn.transaction_type === 'unrealized_gain_change' && txn.round_name) {
        // These get processed per-group below via roundMap
        const group = txn.portfolio_group ?? companyDefaultGroup
        const list = groupTxns.get(group) ?? []
        list.push(txn)
        groupTxns.set(group, list)
      }
    }

    // If no investment/proceeds transactions at all, create a single empty-group entry
    if (groupTxns.size === 0) {
      groupTxns.set(companyDefaultGroup, [])
    }

    // Third pass: compute summary per (company, group) pair
    for (const [group, gTxns] of Array.from(groupTxns.entries())) {
      let totalInvested = 0
      let totalShares = 0
      let totalRealized = 0

      const groupCashFlows: CashFlow[] = []
      const roundMap = new Map<string, { investmentCost: number; sharesAcquired: number; unrealizedValueChange: number; costBasisExited: number }>()

      for (const txn of gTxns) {
        if (txn.transaction_type === 'investment') {
          totalInvested += txn.investment_cost ?? 0
          totalShares += txn.shares_acquired ?? 0

          if (txn.transaction_date && txn.investment_cost) {
            const cf: CashFlow = { date: new Date(txn.transaction_date), amount: -(txn.investment_cost) }
            groupCashFlows.push(cf)
            allCashFlows.push(cf)
          }

          const roundName = txn.round_name ?? 'Unknown'
          const existing = roundMap.get(roundName)
          if (existing) {
            existing.investmentCost += txn.investment_cost ?? 0
            existing.sharesAcquired += txn.shares_acquired ?? 0
          } else {
            roundMap.set(roundName, {
              investmentCost: txn.investment_cost ?? 0,
              sharesAcquired: txn.shares_acquired ?? 0,
              unrealizedValueChange: 0,
              costBasisExited: 0,
            })
          }
        }
        if (txn.transaction_type === 'proceeds') {
          const proceedsAmount = (txn.proceeds_received ?? 0) + (txn.proceeds_escrow ?? 0)
          totalRealized += proceedsAmount
          if (txn.round_name && txn.cost_basis_exited != null) {
            const round = roundMap.get(txn.round_name)
            if (round) round.costBasisExited += txn.cost_basis_exited
          }

          if (txn.transaction_date && proceedsAmount > 0) {
            const cf: CashFlow = { date: new Date(txn.transaction_date), amount: proceedsAmount }
            groupCashFlows.push(cf)
            allCashFlows.push(cf)
          }
        }
        if (txn.transaction_type === 'unrealized_gain_change') {
          if (txn.round_name && txn.unrealized_value_change != null) {
            const round = roundMap.get(txn.round_name)
            if (round) round.unrealizedValueChange += txn.unrealized_value_change
          }
        }
      }

      // Sum per-round FMV using the company-wide share price
      let unrealizedValue = 0
      for (const round of Array.from(roundMap.values())) {
        if (round.sharesAcquired > 0) {
          unrealizedValue += latestSharePrice != null ? round.sharesAcquired * latestSharePrice : 0
        } else {
          unrealizedValue += round.investmentCost - round.costBasisExited + round.unrealizedValueChange
        }
      }
      let fmv: number
      if (company.status === 'exited') {
        fmv = totalRealized
      } else if (company.status === 'written-off') {
        fmv = 0
      } else {
        fmv = unrealizedValue
      }

      const moic = totalInvested > 0 ? (totalRealized + unrealizedValue) / totalInvested : null

      // Compute per-group IRR
      let groupIRR: number | null = null
      if (groupCashFlows.length > 0) {
        const terminalValue = company.status === 'written-off' ? 0 : unrealizedValue
        if (terminalValue > 0 || totalRealized > 0) {
          if (company.status !== 'exited' && terminalValue > 0) {
            groupCashFlows.push({ date: asOfDate, amount: terminalValue })
          }
          groupIRR = xirr(groupCashFlows)
        }
      }

      portfolioInvested += totalInvested
      portfolioRealized += totalRealized
      portfolioUnrealized += unrealizedValue
      portfolioFMV += fmv

      companySummaries.push({
        companyId,
        companyName: company.name,
        status: company.status,
        portfolioGroup: [group].filter(Boolean),
        totalInvested,
        totalRealized,
        unrealizedValue,
        fmv,
        moic,
        irr: groupIRR,
      })
    }
  }

  // Sort by invested amount descending
  companySummaries.sort((a, b) => b.totalInvested - a.totalInvested)

  const portfolioMOIC = portfolioInvested > 0
    ? (portfolioRealized + portfolioUnrealized) / portfolioInvested
    : null

  // Portfolio-level IRR: add total unrealized as terminal cash flow
  let portfolioIRR: number | null = null
  if (allCashFlows.length > 0 && portfolioUnrealized > 0) {
    allCashFlows.push({ date: asOfDate, amount: portfolioUnrealized })
    portfolioIRR = xirr(allCashFlows)
  }

  return NextResponse.json({
    totalInvested: portfolioInvested,
    totalRealized: portfolioRealized,
    totalUnrealized: portfolioUnrealized,
    totalFMV: portfolioFMV,
    portfolioMOIC,
    portfolioIRR,
    companies: companySummaries,
  })
}
