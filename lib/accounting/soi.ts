// Schedule-of-investments positions, derived from the portfolio tracker rather
// than the ledger. The ledger knows only totals (one investment-cost account, one
// unrealized account); the tracker knows the per-company detail an ASC 946 SOI
// needs — shares, price, industry. So the SOI reads the tracker for its ROWS and
// the ledger for its CONTROL TOTALS, and reports the variance between them.
//
// Valuation math is NOT reimplemented here: computeSummary() in lib/investments.ts
// is the canonical roll-up (priced equity → shares × latest price; SAFEs/notes →
// cost + cumulative value change). There are already several drifted copies of it
// in the codebase; this is deliberately not another one.

import { computeSummary } from '@/lib/investments'
import type { InvestmentTransaction, CompanyStatus } from '@/lib/types/database'

const r = (n: number) => Math.round(n * 100) / 100

/** Labels for `investment_transactions.security_type` (see migration 20260712000000). */
const SECURITY_LABELS: Record<string, string> = {
  preferred: 'Preferred stock',
  common: 'Common stock',
  safe: 'SAFE',
  convertible_note: 'Convertible note',
  warrant: 'Warrant',
  option: 'Option',
  llc_units: 'LLC units',
  other: 'Other',
}

export interface SoiPosition {
  companyId: string
  name: string
  industry: string | null
  /** ASC 946 geography band. Null until companies.country is populated. */
  country: string | null
  stage: string | null
  status: CompanyStatus
  /** From investment_transactions.security_type when set; otherwise derived. */
  assetType: string
  shares: number | null
  sharePrice: number | null
  /** Remaining cost basis (cost less any basis exited). */
  cost: number
  fairValue: number
  unrealized: number
  moic: number | null
}

export interface SoiCompany {
  id: string
  name: string
  status: CompanyStatus
  industry: string[] | null
  stage: string | null
  /** Added by migration 20260712000000; undefined until it's pushed. */
  country?: string | null
  /** text[] — a company can be held by several vehicles. */
  portfolio_group: string[] | null
}

/**
 * The instrument held. Prefers the recorded `security_type`; falls back to the
 * derived two-bucket proxy so the SOI still groups sensibly on rows that predate
 * the column (or where it was never set).
 */
function assetTypeOf(txns: InvestmentTransaction[], hasShares: boolean, hasPrice: boolean): string {
  const recorded = txns
    .filter(t => t.transaction_type === 'investment')
    .map(t => (t as any).security_type as string | null | undefined)
    .find(Boolean)
  if (recorded) return SECURITY_LABELS[recorded] ?? recorded
  return hasShares && hasPrice ? 'Priced equity' : 'Convertible / SAFE'
}

/**
 * Transactions relevant to one company in one vehicle.
 *
 * `investment_transactions.portfolio_group` is a SCALAR text column (only
 * `companies.portfolio_group` is text[]), so it must be compared with `===`.
 * Using `.includes()` here would be a substring test — "Ledgerline SPV II" contains
 * "Ledgerline SPV" — which is exactly the bug that was in lib/lp-letters/aggregate.ts.
 *
 * Untagged `round_info` / `unrealized_gain_change` rows are company-wide pricing
 * signals (a later round the fund didn't participate in), so they count for every
 * vehicle holding that company — without them the position marks at entry price.
 */
export function txnsForVehicle(txns: InvestmentTransaction[], vehicle: string): InvestmentTransaction[] {
  const inVehicle = txns.filter(t => t.portfolio_group === vehicle)
  const priceSignals = txns.filter(t =>
    !t.portfolio_group &&
    (t.transaction_type === 'unrealized_gain_change' || t.transaction_type === 'round_info')
  )
  return [...inVehicle, ...priceSignals]
}

/** One SOI position per company the vehicle holds. Companies with no remaining basis
 *  and no value (fully exited / written off) are dropped. */
export function buildSoiPositions(
  txns: InvestmentTransaction[],
  companies: SoiCompany[],
  vehicle: string,
  asOf?: Date
): SoiPosition[] {
  const byCompany = new Map<string, InvestmentTransaction[]>()
  for (const t of txns) {
    if (!byCompany.has(t.company_id)) byCompany.set(t.company_id, [])
    byCompany.get(t.company_id)!.push(t)
  }

  const positions: SoiPosition[] = []
  for (const company of companies) {
    const all = byCompany.get(company.id) ?? []
    const relevant = txnsForVehicle(all, vehicle)
    // A company-wide price signal alone isn't a holding — require real investment.
    if (!relevant.some(t => t.transaction_type === 'investment' && t.portfolio_group === vehicle)) continue

    const s = computeSummary(relevant, company.status, asOf)
    const exited = s.rounds.reduce((sum, rd) => sum + Math.abs(rd.costBasisExited ?? 0), 0)
    const cost = r(s.totalInvested - exited)
    // unrealizedValue, not fmv: fmv reports PROCEEDS for an exited company, which is
    // not a carrying value and would misstate the balance sheet.
    const fairValue = r(s.unrealizedValue)
    if (cost === 0 && fairValue === 0) continue

    const shares = s.totalShares || null
    positions.push({
      companyId: company.id,
      name: company.name,
      industry: company.industry?.[0] ?? null,
      country: company.country ?? null,
      stage: company.stage ?? null,
      status: company.status,
      assetType: assetTypeOf(relevant, !!shares, !!s.latestSharePrice),
      shares,
      sharePrice: s.latestSharePrice,
      cost,
      fairValue,
      unrealized: r(fairValue - cost),
      moic: s.moic,
    })
  }

  return positions.sort((a, b) => b.fairValue - a.fairValue)
}
