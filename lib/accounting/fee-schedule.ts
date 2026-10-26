// A vehicle's dated management fee schedule, and the fee it charges for a period.
//
// The fee used to be one rate on commitments for whatever fraction of a year the person booking it
// typed (allocation-actions.ts). An LPA states it on dates: quarterly in advance, 2% of commitments
// until the end of the investment period, then 1.5% of invested capital, less organizational
// expenses above a cap. The schedule stores that wording (`vehicle_accounting_settings.fee_schedule`)
// and the fund engine's `feeSchedule` runs it, the reading the Walter spec takes
// (spec/07-management-fees.md). This module only reads the books into its facts:
//
//   - commitments from `lp_investments`, with the partners the Allocation terms page exempts from
//     the management fee left out of the fee-bearing set;
//   - invested capital from the vehicle's investment and proceeds transactions (the same deal
//     histories the deal-by-deal waterfall reads), a deal's cost leaving when a proceeds row
//     exits it or its company is closed out;
//   - NAV as the partners' capital accounts on each period's first day;
//   - organizational expenses as the close has allocated them to the partners.
//
// Portfolio-company fees aren't in the fund's books (the GP or the management company is paid them),
// so they're recorded separately (`portfolio_company_fees`, lib/accounting/portfolio-fees.ts), and
// the schedule's `offsets` say what share of each kind credits the fee.
//
// Side letters still apply. The period's net fee is shared across the fee-bearing partners by
// commitment, each weighted by its own rate over the schedule's rate in force that period.

import type { SupabaseClient } from '@supabase/supabase-js'
import { addMonths, allocateAmount, feeSchedule, roundCents, type FeeFrequency, type FeeScheduleBasis, type FeeSchedulePeriod } from '@portfolio/fund-engine'
import { computeCapitalAccounts } from './capital-account'
import { loadOwnership, loadPostedLedger } from './load'
import { loadPartnerTerms } from './terms'
import { dealHistories } from './realized-capital'
import { vehicleIdByName } from './vehicle-id'
import { loadPortfolioFees, PORTFOLIO_FEE_KINDS, type PortfolioFeeKind } from './portfolio-fees'
import type { FeeResult } from './fees'

export interface StoredFeeSchedule {
  frequency: FeeFrequency
  /** YYYY-MM-DD, the first period's first day. */
  start: string
  /** YYYY-MM-DD, exclusive: the day the fee stops. */
  end: string
  /** Each step from its date, in order. */
  steps: { from: string; rate: number; basis: FeeScheduleBasis }[]
  /** Organizational expenses above this offset the fee dollar for dollar. Absent: no cap. */
  organizationalExpenseCap?: number
  /** Share (0 to 1) of each kind of portfolio-company fee that offsets the fee. Absent: none. */
  offsets?: Partial<Record<PortfolioFeeKind, number>>
}

const FREQUENCIES: FeeFrequency[] = ['quarterly', 'semiannual', 'annual']
const BASES: FeeScheduleBasis[] = ['commitments', 'invested', 'nav']
const DATE = /^\d{4}-\d{2}-\d{2}$/

/** Check a schedule without touching the database. Null clears it. */
export function parseFeeScheduleInput(raw: unknown): { ok: true; value: StoredFeeSchedule | null } | { error: string } {
  if (raw == null) return { ok: true, value: null }
  if (typeof raw !== 'object') return { error: 'The fee schedule must be an object.' }
  const s = raw as Record<string, unknown>
  if (!FREQUENCIES.includes(s.frequency as FeeFrequency)) return { error: 'The fee is charged quarterly, semiannually or annually.' }
  if (typeof s.start !== 'string' || !DATE.test(s.start)) return { error: 'The fee schedule needs a start date (YYYY-MM-DD).' }
  if (typeof s.end !== 'string' || !DATE.test(s.end) || s.end <= s.start) return { error: 'The fee schedule needs an end date after its start.' }
  if (!Array.isArray(s.steps) || s.steps.length === 0) return { error: 'The fee schedule needs at least one rate.' }
  const steps: StoredFeeSchedule['steps'] = []
  for (const raw of s.steps as any[]) {
    const rate = Number(raw?.rate)
    if (typeof raw?.from !== 'string' || !DATE.test(raw.from)) return { error: 'Each rate starts on a date (YYYY-MM-DD).' }
    if (!(rate >= 0 && rate <= 0.2)) return { error: 'Each rate is an annual fraction between 0 and 0.2 (0.02 = 2%).' }
    if (!BASES.includes(raw?.basis)) return { error: 'Each rate is charged on commitments, invested capital or NAV.' }
    steps.push({ from: raw.from, rate, basis: raw.basis })
  }
  steps.sort((a, b) => a.from.localeCompare(b.from))
  if (steps[0].from > s.start) return { error: 'The first rate must start on or before the schedule does.' }
  if (new Set(steps.map(x => x.from)).size !== steps.length) return { error: 'Two rates start on the same date.' }
  const cap = s.organizationalExpenseCap == null || s.organizationalExpenseCap === '' ? undefined : Number(s.organizationalExpenseCap)
  if (cap !== undefined && !(cap >= 0)) return { error: 'The organizational expense cap must be zero or more.' }
  let offsets: StoredFeeSchedule['offsets']
  if (s.offsets != null) {
    if (typeof s.offsets !== 'object' || Array.isArray(s.offsets)) return { error: 'The offsets are a share for each kind of portfolio-company fee.' }
    for (const [kind, raw] of Object.entries(s.offsets as Record<string, unknown>)) {
      if (!PORTFOLIO_FEE_KINDS.includes(kind as PortfolioFeeKind)) return { error: `"${kind}" is not a kind of portfolio-company fee.` }
      if (raw == null || raw === '') continue
      const share = Number(raw)
      if (!(share >= 0 && share <= 1)) return { error: 'Each offset is a share between 0 and 1 (1 = 100%).' }
      if (share > 0) (offsets ??= {})[kind as PortfolioFeeKind] = share
    }
  }
  return {
    ok: true,
    value: {
      frequency: s.frequency as FeeFrequency,
      start: s.start,
      end: s.end,
      steps,
      ...(cap !== undefined ? { organizationalExpenseCap: cap } : {}),
      ...(offsets ? { offsets } : {}),
    },
  }
}

export async function loadFeeSchedule(admin: SupabaseClient, fundId: string, group: string): Promise<StoredFeeSchedule | null> {
  const vehicleId = await vehicleIdByName(admin, fundId, group)
  if (!vehicleId) return null
  const { data } = await (admin as any).from('vehicle_accounting_settings').select('fee_schedule').eq('fund_id', fundId).eq('vehicle_id', vehicleId).maybeSingle()
  const parsed = parseFeeScheduleInput(data?.fee_schedule ?? null)
  return 'ok' in parsed ? parsed.value : null
}

export async function saveFeeSchedule(
  admin: SupabaseClient,
  fundId: string,
  group: string,
  raw: unknown,
): Promise<{ ok: true; schedule: StoredFeeSchedule | null } | { error: string; status: number; dbError?: { message: string } }> {
  const vehicleId = await vehicleIdByName(admin, fundId, group)
  if (!vehicleId) return { error: `Unknown vehicle "${group}".`, status: 400 }
  const parsed = parseFeeScheduleInput(raw)
  if ('error' in parsed) return { error: parsed.error, status: 400 }
  const { error } = await (admin as any)
    .from('vehicle_accounting_settings')
    .upsert({ fund_id: fundId, vehicle_id: vehicleId, fee_schedule: parsed.value, updated_at: new Date().toISOString() }, { onConflict: 'fund_id,vehicle_id' })
  if (error) return { error: 'The fee schedule could not be saved.', status: 500, dbError: error }
  return { ok: true, schedule: parsed.value }
}

export interface ScheduledFee {
  period: FeeSchedulePeriod
  /** The schedule's rate in force on the period's first day, which side letters are measured against. */
  rate: number
  fee: FeeResult
}

/**
 * The fee the schedule charges for the period that `date` falls in, shared across the partners.
 * Null when `date` is outside the schedule.
 */
export async function scheduledFee(
  admin: SupabaseClient,
  fundId: string,
  group: string,
  date: string,
  overrides: Record<string, { rateOverride?: number; exempt?: boolean }> = {},
): Promise<ScheduledFee | { error: string } | null> {
  const schedule = await loadFeeSchedule(admin, fundId, group)
  if (!schedule) return { error: `${group} has no fee schedule. Set one on the Allocation terms page, or give a rate.` }
  if (date < schedule.start || date >= schedule.end) return null

  const [owners, terms, ledger, txns, companies, portfolioFees] = await Promise.all([
    loadOwnership(admin, fundId, group),
    loadPartnerTerms(admin, fundId, group),
    loadPostedLedger(admin, fundId, group),
    admin.from('investment_transactions' as any)
      .select('company_id, portfolio_group, transaction_type, transaction_date, investment_cost, fee_amount, cost_basis_exited')
      .eq('fund_id', fundId).eq('portfolio_group', group),
    admin.from('companies' as any).select('id, status').eq('fund_id', fundId),
    schedule.offsets ? loadPortfolioFees(admin, fundId, group, schedule.end) : Promise.resolve([]),
  ])
  if (txns.error || companies.error) return { error: 'The deals could not be read, so the fee on invested capital cannot be worked out.' }
  if ('error' in portfolioFees) return { error: 'The portfolio-company fees could not be read, so their offsets cannot be worked out.' }

  const feeTerms = new Map(terms.filter(t => t.category === 'management_fee').map(t => [t.lpEntityId, t]))
  const payers = owners.filter(o => o.commitment > 0).map(o => {
    const configured = feeTerms.get(o.lpEntityId)
    return {
      lpEntityId: o.lpEntityId,
      commitment: o.commitment,
      rateOverride: overrides[o.lpEntityId]?.rateOverride ?? configured?.rateOverride ?? null,
      exempt: overrides[o.lpEntityId]?.exempt ?? (configured ? !configured.participates : false),
    }
  })
  const bearing = payers.filter(p => !p.exempt)

  const deals = dealHistories((txns.data as any[]) ?? [], (companies.data as any[]) ?? [], group, schedule.end)
  const investments = deals.flatMap(d => d.investments.map(i => ({ date: i.date, deal: d.companyId, amount: i.amount })))
  const exits = deals.flatMap(d => [
    ...d.realizations.map(r => ({ date: r.date, deal: d.companyId, ...(r.costExited != null ? { cost: r.costExited } : {}) })),
    ...(d.closedOn ? [{ date: d.closedOn, deal: d.companyId }] : []),
  ])

  // NAV on each day the schedule could read it: every period start and step date.
  const days = new Set<string>(schedule.steps.map(s => s.from))
  const step = { quarterly: 3, semiannual: 6, annual: 12 }[schedule.frequency]
  for (let d = schedule.start; d < schedule.end; d = addMonths(d, step)) days.add(d)
  const navs = schedule.steps.some(s => s.basis === 'nav')
    ? [...days].sort().map(day => ({
        date: day,
        amount: roundCents([...computeCapitalAccounts(ledger.capitalPostings, { end: day }).values()].reduce((s, a) => s + a.ending, 0)),
      }))
    : []
  const organizationalExpenses = ledger.capitalPostings
    .filter(p => p.sourceType === 'organizational_expense' && p.entryDate && p.amount > 0)
    .map(p => ({ date: p.entryDate!, amount: p.amount }))

  const periods = feeSchedule({
    frequency: schedule.frequency,
    start: schedule.start,
    end: schedule.end,
    steps: schedule.steps,
    ...(schedule.organizationalExpenseCap !== undefined ? { organizationalExpenseCap: schedule.organizationalExpenseCap } : {}),
    ...(schedule.offsets ? { offsets: schedule.offsets as Record<string, number> } : {}),
  }, {
    feeBearingCommitments: bearing.reduce((s, p) => s + p.commitment, 0),
    allCommitments: payers.reduce((s, p) => s + p.commitment, 0),
    investments,
    exits,
    navs,
    organizationalExpenses,
    portfolioFees: portfolioFees.map(f => ({ date: f.date, kind: f.kind, amount: f.amount })),
  })
  const period = periods.find(p => p.start <= date && date < p.end)
  if (!period) return null

  const rate = [...schedule.steps].reverse().find(s => s.from <= period.start)?.rate ?? 0
  const weight = (p: (typeof bearing)[number]) => p.commitment * (rate > 0 && p.rateOverride != null ? p.rateOverride / rate : 1)
  const shares = allocateAmount(period.net, bearing.map(p => ({ lpEntityId: p.lpEntityId, commitment: weight(p) })))
  const lines = payers.map(p => ({
    lpEntityId: p.lpEntityId,
    basisAmount: p.commitment,
    rate: p.exempt ? 0 : (p.rateOverride ?? rate),
    fee: p.exempt ? 0 : (shares.get(p.lpEntityId) ?? 0),
  }))
  return { period, rate, fee: { lines, total: roundCents(lines.reduce((s, l) => s + l.fee, 0)) } }
}

