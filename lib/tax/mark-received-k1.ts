// Recording what became of a K-1 a fund holding owes us: received, amended, or not owed after all.
//
// Shared by the tax page's route (app/api/accounting/received-k1s) and the agent's mark_holding_k_one
// tool. The expectation itself is derived from the holdings (received-k1s.ts); what is stored is only
// the departure from it.

import type { SupabaseClient } from '@supabase/supabase-js'
import { K1_EXPECTED_HOLDING_TYPE } from './received-k1s'
import { dbFail, done, fail, type Outcome } from '@/lib/service-outcome'
import { parseReceivedK1Amounts, receivedK1AmountProblems, rowFromAmounts, type ReceivedK1Amounts } from './received-k1-amounts'

export const RECEIVED_K1_STATUSES = ['expected', 'received', 'amended', 'not_expected'] as const

export interface MarkReceivedK1Input {
  companyId: string
  taxYear: number
  status: string
  receivedDate?: string | null
  reportedOrdinaryIncome?: number | null
  reportedCapitalGain?: number | null
  reportedEndingCapital?: number | null
  notes?: string | null
  /**
   * The K-1's boxes (received-k1-amounts.ts). Omitted leaves any amounts already recorded as they
   * are — a status change must not wipe a K-1 someone keyed in. `null` clears them. An object
   * replaces them all: a box left out of it is cleared, because the object IS the K-1.
   */
  amounts?: ReceivedK1Amounts | Record<string, unknown> | null
}

/**
 * `vehicleId` is the caller's entity that received it, already checked as theirs, or null for an
 * unscoped caller recording it firm-wide.
 */
export async function markReceivedK1(
  admin: SupabaseClient, fundId: string, userId: string, vehicleId: string | null, body: MarkReceivedK1Input,
): Promise<Outcome<any>> {
  const companyId = typeof body?.companyId === 'string' ? body.companyId : ''
  const taxYear = Number(body?.taxYear)
  if (!companyId || !Number.isInteger(taxYear)) return fail(400, 'companyId and taxYear are required')
  if (!(RECEIVED_K1_STATUSES as readonly string[]).includes(body?.status)) {
    return fail(400, `status must be one of ${RECEIVED_K1_STATUSES.join(', ')}`)
  }

  // The holding must belong to this fund AND be a fund holding. Filtering the discriminator
  // here is stricter than an allowlist would be: only a partnership files a K-1, so marking a
  // portfolio company as owing one is a mistake worth refusing rather than storing.
  const { data: company } = await admin
    .from('companies' as any)
    .select('id')
    .eq('fund_id', fundId)
    .eq('id', companyId)
    .eq('holding_type', K1_EXPECTED_HOLDING_TYPE)
    .maybeSingle()
  if (!company) return fail(400, 'Unknown holding for this fund, or not a fund holding — only a partnership files a K-1.')

  // Amounts: parsed and checked before anything is written.
  let amountColumns: Record<string, unknown> = {}
  let parsed: ReceivedK1Amounts | null = null
  if (body?.amounts === null) {
    amountColumns = { ...rowFromAmounts({}), amounts_recorded_at: null, amounts_recorded_by: null }
  } else if (body?.amounts !== undefined) {
    if (body.status !== 'received' && body.status !== 'amended') {
      return fail(400, 'Amounts belong to a K-1 that has arrived: record the status as received (or amended) with them.')
    }
    const p = parseReceivedK1Amounts(body.amounts)
    if ('error' in p) return fail(400, p.error)
    const problems = receivedK1AmountProblems(p.amounts)
    if (problems.length > 0) return fail(400, problems.join(' '))
    parsed = p.amounts
    amountColumns = { ...rowFromAmounts(p.amounts), amounts_recorded_at: new Date().toISOString(), amounts_recorded_by: userId }
  }

  const { data, error } = await admin
    .from('received_k1s' as any)
    .upsert(
      {
        fund_id: fundId,
        vehicle_id: vehicleId,
        company_id: companyId,
        tax_year: taxYear,
        status: body.status,
        received_date: typeof body?.receivedDate === 'string' ? body.receivedDate : null,
        // The three original tie-out figures, filled from the boxes when the boxes are given and
        // the figures are not, so older readers of these columns see the same K-1.
        reported_ordinary_income: body?.reportedOrdinaryIncome ?? parsed?.ordinaryBusinessIncome ?? null,
        reported_capital_gain: body?.reportedCapitalGain
          ?? (parsed && (parsed.shortTermGain !== undefined || parsed.longTermGain !== undefined)
            ? Math.round(((parsed.shortTermGain ?? 0) + (parsed.longTermGain ?? 0)) * 100) / 100 : null),
        reported_ending_capital: body?.reportedEndingCapital ?? parsed?.capitalEnding ?? null,
        notes: typeof body?.notes === 'string' ? body.notes.slice(0, 2000) : null,
        ...amountColumns,
        created_by: userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'company_id,tax_year' },
    )
    .select('*')
    .single()
  if (error) return dbFail(error, 'received-k1s')
  return done(data)
}
