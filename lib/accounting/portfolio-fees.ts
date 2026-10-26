// Fees the GP earns from portfolio companies, recorded so the fee schedule can offset them.
//
// An LPA often credits transaction, monitoring and directors' fees against the management fee, all
// of them or a share. They're paid to the GP or the management company, not the fund, so the fund's
// books never see them; `portfolio_company_fees` is where they're entered. The vehicle's fee
// schedule says what share of each kind offsets the fee (`StoredFeeSchedule.offsets`), and
// `scheduledFee` hands both to the fund engine's `feeSchedule`, which credits a fee in the period
// it's dated in and carries any offset the period couldn't use into the next.

import type { SupabaseClient } from '@supabase/supabase-js'
import { roundCents } from '@portfolio/fund-engine'
import { vehicleIdByName } from './vehicle-id'

// ILPA's list (Reporting Template B.1), in its order: nine kinds of fee, and the reimbursements for
// travel and administrative expenses the template totals on their own line.
export const PORTFOLIO_FEE_KINDS = [
  'advisory', 'broken_deal', 'transaction', 'directors', 'monitoring', 'capital_markets',
  'arrangement', 'origination', 'other', 'reimbursement',
] as const
export type PortfolioFeeKind = (typeof PORTFOLIO_FEE_KINDS)[number]

export interface PortfolioFee {
  id: string
  /** YYYY-MM-DD. */
  date: string
  kind: PortfolioFeeKind
  amount: number
  /** The part that belongs to affiliated positions (co-investors the adviser manages), on top of `amount`. */
  affiliatedAmount: number | null
  companyId: string | null
  memo: string | null
}

export interface PortfolioFeeInput {
  date: string
  kind: PortfolioFeeKind
  amount: number
  affiliatedAmount: number | null
  companyId: string | null
  memo: string | null
}

const DATE = /^\d{4}-\d{2}-\d{2}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Check one fee without touching the database. */
export function parsePortfolioFeeInput(raw: unknown): { ok: true; value: PortfolioFeeInput } | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: 'The fee must be an object.' }
  const f = raw as Record<string, unknown>
  if (typeof f.date !== 'string' || !DATE.test(f.date)) return { error: 'The fee needs a date (YYYY-MM-DD).' }
  if (!PORTFOLIO_FEE_KINDS.includes(f.kind as PortfolioFeeKind)) return { error: `The fee's kind is one of ${PORTFOLIO_FEE_KINDS.join(', ')}.` }
  const amount = Number(f.amount)
  if (!(amount > 0) || !Number.isFinite(amount)) return { error: 'The fee needs an amount above zero.' }
  const affiliatedAmount = f.affiliatedAmount == null || f.affiliatedAmount === '' ? null : Number(f.affiliatedAmount)
  if (affiliatedAmount !== null && !(affiliatedAmount >= 0 && Number.isFinite(affiliatedAmount))) return { error: "The affiliated positions' share must be zero or more." }
  const companyId = f.companyId == null || f.companyId === '' ? null : String(f.companyId)
  if (companyId && !UUID.test(companyId)) return { error: 'The company is not one of the fund\'s.' }
  const memo = typeof f.memo === 'string' && f.memo.trim() ? f.memo.trim().slice(0, 500) : null
  return { ok: true, value: { date: f.date, kind: f.kind as PortfolioFeeKind, amount: roundCents(amount), affiliatedAmount: affiliatedAmount === null ? null : roundCents(affiliatedAmount), companyId, memo } }
}

const fromRow = (r: any): PortfolioFee => ({
  id: r.id,
  date: r.fee_date,
  kind: r.kind,
  amount: Number(r.amount),
  affiliatedAmount: r.affiliated_amount == null ? null : Number(r.affiliated_amount),
  companyId: r.company_id ?? null,
  memo: r.memo ?? null,
})

/** A vehicle's portfolio-company fees, oldest first, optionally only those before `before`. */
export async function loadPortfolioFees(admin: SupabaseClient, fundId: string, group: string, before?: string): Promise<PortfolioFee[] | { error: string }> {
  const vehicleId = await vehicleIdByName(admin, fundId, group)
  if (!vehicleId) return []
  let q = (admin as any).from('portfolio_company_fees')
    .select('*')
    .eq('fund_id', fundId).eq('vehicle_id', vehicleId)
  if (before) q = q.lt('fee_date', before)
  const { data, error } = await q.order('fee_date', { ascending: true })
  if (error) return { error: 'The portfolio-company fees could not be read.' }
  return ((data as any[]) ?? []).map(fromRow)
}

export async function addPortfolioFee(
  admin: SupabaseClient,
  fundId: string,
  group: string,
  raw: unknown,
  userId: string,
): Promise<{ ok: true; fee: PortfolioFee } | { error: string; status: number; dbError?: { message: string } }> {
  const vehicleId = await vehicleIdByName(admin, fundId, group)
  if (!vehicleId) return { error: `Unknown vehicle "${group}".`, status: 400 }
  const parsed = parsePortfolioFeeInput(raw)
  if ('error' in parsed) return { error: parsed.error, status: 400 }
  const f = parsed.value
  if (f.companyId) {
    // Any holding the fund owns can pay a fee, a fund holding included.
    const { data } = await admin.from('companies' as any).select('id').eq('fund_id', fundId).eq('id', f.companyId).maybeSingle()
    if (!data) return { error: 'The company is not one of the fund\'s.', status: 400 }
  }
  const { data, error } = await (admin as any).from('portfolio_company_fees')
    .insert({
      fund_id: fundId, vehicle_id: vehicleId, company_id: f.companyId, fee_date: f.date, kind: f.kind, amount: f.amount,
      // Only when given, so a fee without one still saves before the column is migrated.
      ...(f.affiliatedAmount !== null ? { affiliated_amount: f.affiliatedAmount } : {}),
      memo: f.memo, created_by: userId,
    })
    .select('*')
    .single()
  if (error) return { error: 'The fee could not be saved.', status: 500, dbError: error }
  return { ok: true, fee: fromRow(data) }
}

export async function deletePortfolioFee(
  admin: SupabaseClient,
  fundId: string,
  group: string,
  id: string,
): Promise<{ ok: true } | { error: string; status: number; dbError?: { message: string } }> {
  const vehicleId = await vehicleIdByName(admin, fundId, group)
  if (!vehicleId) return { error: `Unknown vehicle "${group}".`, status: 400 }
  if (!UUID.test(id)) return { error: 'No such fee.', status: 404 }
  const { data, error } = await (admin as any).from('portfolio_company_fees')
    .delete().eq('fund_id', fundId).eq('vehicle_id', vehicleId).eq('id', id).select('id')
  if (error) return { error: 'The fee could not be deleted.', status: 500, dbError: error }
  if (!data?.length) return { error: 'No such fee.', status: 404 }
  return { ok: true }
}
