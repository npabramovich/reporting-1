// Accounting books for the Hemrock Ventures demo — Fund I and Fund II.
//
// The demo already had three separate descriptions of the same money that never met:
// `fund_cash_flows` (the capital calls), `investment_transactions` (the portfolio
// tracker), and `lp_investments` (the LP snapshot). This seeds a real double-entry
// ledger that reconciles all three, so every accounting page has something true to
// show: statements that balance, capital accounts that sum to net assets, a schedule
// of investments that ties to the ledger per company, and closed periods back to
// inception.
//
// Nothing here is hand-entered as a balance. The ledger is BUILT from the same
// sources the rest of the demo uses:
//
//   contributions  ← FUND_CASH_FLOWS capital calls, split pro-rata by commitment
//   investments    ← investment_transactions, replayed on their own dates
//   fees/expenses  ← the schedule below
//   capital accts  ← the period close, allocating P&L month by month
//
// and then the LP snapshot is rewritten FROM the closed ledger (see
// `reconcileLpSnapshotToLedger`), so Reconciliation ties to the penny instead of
// showing a variance nobody can explain.
//
// Cash is the constraint that shapes the fee schedule. The demo's capital calls are
// modest in the early years — Fund I holds $100K after its first investment — so a
// fund charging 2% on commitments from day one would overdraw. Fees therefore ACCRUE
// quarterly to `2100 Due to GP` and are PAID when called capital arrives, which is
// both what real funds do and what keeps cash non-negative on every date. The seeder
// asserts that (see `assertCashNeverNegative`) rather than trusting the arithmetic.

import type { createAdminClient } from '@/lib/supabase/admin'
import { DEFAULT_CHART } from '@/lib/accounting/chart'
import { accountIdByCode, ensureCapitalAccounts, persistEntry } from '@/lib/accounting/persist'
import { vehicleIdByName } from '@/lib/accounting/vehicle-id'
import { saveHistoryMode, saveAllocationBasis } from '@/lib/accounting/terms'
import { replayInvestmentHistory } from '@/lib/accounting/investments'
import { closeThrough } from '@/lib/accounting/close'
import { loadPostedLedger } from '@/lib/accounting/load'
import { computeCapitalAccounts } from '@/lib/accounting/capital-account'
import type { Posting, JournalEntry } from '@/lib/accounting/types'

type Admin = ReturnType<typeof createAdminClient>

const round2 = (n: number) => Math.round(n * 100) / 100

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

interface CashEvent {
  date: string
  /** Chart code the cash moves against. */
  code: string
  /** Signed against CASH: positive = cash in, negative = cash out. */
  cash: number
  sourceType: string
  memo: string
}

interface VehiclePlan {
  group: string
  /** Every partner's commitment is dated here — the fund's final close. */
  commitmentDate: string
  /** From FUND_CASH_FLOWS. Split across partners pro-rata by commitment. */
  calls: { date: string; amount: number; memo: string }[]
  /** 2% of commitments a year, accrued quarterly to `2100 Due to GP`. */
  quarterlyFee: number
  /** Quarter-ends the fee accrues on. */
  feeAccrualDates: string[]
  /** Paying down `2100 Due to GP` once called capital has arrived. */
  feePayments: { date: string; amount: number; memo: string }[]
  /** Everything else that touches cash. */
  cashEvents: CashEvent[]
  closeThrough: string
}

/** Quarter-ends from `from` through `to`, inclusive. */
function quarterEnds(from: string, to: string): string[] {
  const out: string[] = []
  let y = Number(from.slice(0, 4))
  const endY = Number(to.slice(0, 4))
  while (y <= endY) {
    for (const md of ['03-31', '06-30', '09-30', '12-31']) {
      const d = `${y}-${md}`
      if (d >= from && d <= to) out.push(d)
    }
    y++
  }
  return out
}

const PLANS: VehiclePlan[] = [
  {
    group: 'Fund I',
    commitmentDate: '2022-01-15',
    calls: [
      { date: '2022-03-15', amount: 500_000, memo: 'Capital call #1 — RouteWise Seed + fee reserve' },
      { date: '2023-06-10', amount: 1_800_000, memo: 'Capital call #2 — NovaTech Seed, RouteWise Series A, fees' },
      { date: '2024-01-05', amount: 1_000_000, memo: 'Capital call #3 — GreenLeaf Bio Seed + reserves' },
      { date: '2024-06-01', amount: 2_500_000, memo: 'Capital call #4 — AdVantage Series A + reserves' },
      { date: '2024-09-01', amount: 2_000_000, memo: 'Capital call #5 — NovaTech Series A follow-on + reserves' },
      { date: '2024-11-01', amount: 2_500_000, memo: 'Capital call #6 — RouteWise Series B + reserves' },
    ],
    quarterlyFee: 60_000, // 2% × $12M ÷ 4
    feeAccrualDates: quarterEnds('2022-03-31', '2025-12-31'),
    feePayments: [
      { date: '2023-06-30', amount: 240_000, memo: 'Management fee paid — 2022 accrual' },
      { date: '2024-12-31', amount: 480_000, memo: 'Management fee paid — 2023 and 2024 accruals' },
      { date: '2025-12-31', amount: 240_000, memo: 'Management fee paid — 2025 accrual' },
    ],
    cashEvents: [
      { date: '2022-03-20', code: '5200', cash: -50_000, sourceType: 'organizational_expense', memo: 'Fund formation — legal and organizational costs' },
      { date: '2022-12-31', code: '5100', cash: -35_000, sourceType: 'partnership_expense', memo: 'Audit, tax and fund administration — 2022' },
      { date: '2023-12-31', code: '5100', cash: -35_000, sourceType: 'partnership_expense', memo: 'Audit, tax and fund administration — 2023' },
      { date: '2024-12-31', code: '5100', cash: -35_000, sourceType: 'partnership_expense', memo: 'Audit, tax and fund administration — 2024' },
      { date: '2025-12-31', code: '5100', cash: -35_000, sourceType: 'partnership_expense', memo: 'Audit, tax and fund administration — 2025' },
      { date: '2024-12-31', code: '4100', cash: 30_000, sourceType: 'income', memo: 'Interest on undeployed cash — 2024' },
      { date: '2025-12-31', code: '4100', cash: 25_000, sourceType: 'income', memo: 'Interest on undeployed cash — 2025' },
    ],
    closeThrough: '2025-12-31',
  },
  {
    group: 'Fund II',
    commitmentDate: '2021-11-01',
    calls: [
      { date: '2022-01-10', amount: 500_000, memo: 'Capital call #1 — Benchline Seed + fee reserve' },
      { date: '2023-04-01', amount: 1_800_000, memo: 'Capital call #2 — Benchline Series A, TapFin Seed, fees' },
      { date: '2024-04-15', amount: 1_200_000, memo: 'Capital call #3 — Verdant Seed + reserves' },
      { date: '2024-08-01', amount: 3_200_000, memo: 'Capital call #4 — Benchline Series B, Lattis Pre-Seed, reserves' },
      { date: '2024-12-01', amount: 1_800_000, memo: 'Capital call #5 — TapFin Series A + reserves' },
    ],
    quarterlyFee: 50_000, // 2% × $10M ÷ 4
    feeAccrualDates: quarterEnds('2022-03-31', '2025-12-31'),
    feePayments: [
      { date: '2023-06-30', amount: 200_000, memo: 'Management fee paid — 2022 accrual' },
      { date: '2024-12-31', amount: 400_000, memo: 'Management fee paid — 2023 and 2024 accruals' },
      { date: '2025-12-31', amount: 200_000, memo: 'Management fee paid — 2025 accrual' },
    ],
    cashEvents: [
      { date: '2022-03-20', code: '5200', cash: -40_000, sourceType: 'organizational_expense', memo: 'Fund formation — legal and organizational costs' },
      { date: '2022-12-31', code: '5100', cash: -30_000, sourceType: 'partnership_expense', memo: 'Audit, tax and fund administration — 2022' },
      { date: '2023-12-31', code: '5100', cash: -30_000, sourceType: 'partnership_expense', memo: 'Audit, tax and fund administration — 2023' },
      { date: '2024-12-31', code: '5100', cash: -30_000, sourceType: 'partnership_expense', memo: 'Audit, tax and fund administration — 2024' },
      { date: '2025-12-31', code: '5100', cash: -30_000, sourceType: 'partnership_expense', memo: 'Audit, tax and fund administration — 2025' },
      { date: '2024-12-31', code: '4100', cash: 25_000, sourceType: 'income', memo: 'Interest on undeployed cash — 2024' },
      { date: '2025-12-31', code: '4100', cash: 20_000, sourceType: 'income', memo: 'Interest on undeployed cash — 2025' },
    ],
    closeThrough: '2025-12-31',
  },
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface Partner {
  entityId: string
  entityName: string
  commitment: number
}

/** The vehicle's partners and commitments, from the LP snapshot seed. */
async function loadPartners(admin: Admin, fundId: string, group: string): Promise<Partner[]> {
  const { data } = await (admin as any)
    .from('lp_investments')
    .select('entity_id, commitment, lp_entities ( entity_name )')
    .eq('fund_id', fundId)
    .eq('portfolio_group', group)

  return ((data as any[]) ?? [])
    .filter(r => r.entity_id && Number(r.commitment) > 0)
    .map(r => ({
      entityId: r.entity_id as string,
      entityName: (r.lp_entities?.entity_name as string) ?? 'Partner',
      commitment: Number(r.commitment),
    }))
}

/**
 * Split an amount across partners pro-rata by commitment, in cents, with the
 * remainder plugged onto the largest partner. Without the plug the shares round to
 * something that doesn't sum to the total and `persistEntry` rejects the entry as
 * unbalanced — correctly, since a capital call that doesn't add up isn't a capital call.
 */
function proRata(partners: Partner[], amount: number): { partner: Partner; share: number }[] {
  const total = partners.reduce((s, p) => s + p.commitment, 0)
  if (total <= 0) return []
  const out = partners.map(p => ({ partner: p, share: round2((amount * p.commitment) / total) }))
  const drift = round2(amount - out.reduce((s, o) => s + o.share, 0))
  if (drift !== 0) {
    const biggest = out.reduce((a, b) => (b.partner.commitment > a.partner.commitment ? b : a))
    biggest.share = round2(biggest.share + drift)
  }
  return out
}

/**
 * Every cash movement in date order, so we can prove the fund is never overdrawn
 * before writing a single entry. A demo whose bank balance goes negative in 2022 is
 * worse than no demo — it teaches the reader the books are fiction.
 */
function assertCashNeverNegative(plan: VehiclePlan, investmentCashOut: { date: string; amount: number }[]): void {
  const moves: { date: string; delta: number; what: string }[] = [
    ...plan.calls.map(c => ({ date: c.date, delta: c.amount, what: c.memo })),
    ...plan.feePayments.map(f => ({ date: f.date, delta: -f.amount, what: f.memo })),
    ...plan.cashEvents.map(e => ({ date: e.date, delta: e.cash, what: e.memo })),
    ...investmentCashOut.map(i => ({ date: i.date, delta: -i.amount, what: 'Investment purchase' })),
  ].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))

  let cash = 0
  for (const m of moves) {
    cash = round2(cash + m.delta)
    if (cash < 0) {
      throw new Error(
        `[demo] ${plan.group}: cash would go to ${cash.toFixed(2)} on ${m.date} (${m.what}). ` +
        `Adjust the fee/expense schedule in seed-accounting.ts — the demo must never overdraw.`
      )
    }
  }
}

// ---------------------------------------------------------------------------
// Seeding one vehicle
// ---------------------------------------------------------------------------

async function seedVehicle(admin: Admin, fundId: string, userId: string | null, plan: VehiclePlan): Promise<void> {
  const { group } = plan
  const vehicleId = await vehicleIdByName(admin, fundId, group)
  if (!vehicleId) {
    console.error(`[demo] No fund_vehicles row named "${group}" — skipping its books`)
    return
  }

  const partners = await loadPartners(admin, fundId, group)
  if (partners.length === 0) {
    console.error(`[demo] No LP commitments for "${group}" — skipping its books`)
    return
  }

  // What the tracker says the fund paid for its investments, so the cash check below
  // sees the real outflows rather than assuming the plan's numbers.
  const { data: txns } = await (admin as any)
    .from('investment_transactions')
    .select('transaction_date, investment_cost')
    .eq('fund_id', fundId)
    .eq('portfolio_group', group)
    .not('investment_cost', 'is', null)
  const investmentCashOut = ((txns as any[]) ?? []).map(t => ({
    date: t.transaction_date as string,
    amount: Number(t.investment_cost),
  }))

  assertCashNeverNegative(plan, investmentCashOut)

  // 1. Chart of accounts.
  await (admin as any).from('chart_of_accounts').insert(
    DEFAULT_CHART.map(a => ({
      fund_id: fundId,
      portfolio_group: group,
      vehicle_id: vehicleId,
      code: a.code,
      name: a.name,
      type: a.type,
      subtype: a.subtype ?? null,
    }))
  )

  // 2. How the books were started, and what the close allocates on.
  await saveHistoryMode(admin as any, fundId, group, 'full_history')
  await saveAllocationBasis(admin as any, fundId, group, 'commitment')

  // 3. Per-partner capital accounts, and the commitments the close allocates by.
  await ensureCapitalAccounts(admin as any, fundId, group, partners.map(p => p.entityId))
  await (admin as any).from('commitment_events').insert(
    partners.map(p => ({
      fund_id: fundId,
      vehicle_id: vehicleId,
      lp_entity_id: p.entityId,
      effective_date: plan.commitmentDate,
      amount: p.commitment,
      kind: 'initial',
      memo: 'Subscription at final close',
      created_by: userId,
    }))
  )

  const codes = await accountIdByCode(admin as any, fundId, group)
  const capitalAccounts = await ensureCapitalAccounts(admin as any, fundId, group, partners.map(p => p.entityId))
  const cashId = codes.get('1000')!
  const dueToGpId = codes.get('2100')!

  const write = async (entry: JournalEntry) => {
    const res = await persistEntry(admin as any, fundId, group, userId, entry, 'posted')
    if ('error' in res) console.error(`[demo] ${group} ${entry.entryDate}: ${res.error}`)
  }

  // 4. Capital calls — cash in, each partner's own capital account credited.
  for (const call of plan.calls) {
    const legs: Posting[] = [{ accountId: cashId, amount: call.amount, currency: 'USD', lpEntityId: null }]
    for (const { partner, share } of proRata(partners, call.amount)) {
      legs.push({
        accountId: capitalAccounts.get(partner.entityId)!,
        amount: -share,
        currency: 'USD',
        lpEntityId: partner.entityId,
      })
    }
    await write({ fundId, entryDate: call.date, sourceType: 'capital_call', memo: call.memo, postings: legs })
  }

  // 5. Management fee — accrued quarterly against Due to GP, paid when cash allows.
  //    Accruing rather than paying is what lets a 2% fee coexist with a fund holding
  //    $100K of cash in 2022; it also puts a real liability on the balance sheet.
  for (const date of plan.feeAccrualDates) {
    await write({
      fundId, entryDate: date, sourceType: 'management_fee',
      memo: `Management fee accrued — quarter ended ${date}`,
      postings: [
        { accountId: codes.get('5000')!, amount: plan.quarterlyFee, currency: 'USD', lpEntityId: null },
        { accountId: dueToGpId, amount: -plan.quarterlyFee, currency: 'USD', lpEntityId: null },
      ],
    })
  }
  for (const pay of plan.feePayments) {
    // Settling a liability, not an expense — the expense was booked when it accrued.
    await write({
      fundId, entryDate: pay.date, sourceType: 'manual', memo: pay.memo,
      postings: [
        { accountId: dueToGpId, amount: pay.amount, currency: 'USD', lpEntityId: null },
        { accountId: cashId, amount: -pay.amount, currency: 'USD', lpEntityId: null },
      ],
    })
  }

  // 6. Everything else that moves cash — expenses out, interest in.
  for (const e of plan.cashEvents) {
    await write({
      fundId, entryDate: e.date, sourceType: e.sourceType, memo: e.memo,
      postings: [
        { accountId: codes.get(e.code)!, amount: -e.cash, currency: 'USD', lpEntityId: null },
        { accountId: cashId, amount: e.cash, currency: 'USD', lpEntityId: null },
      ],
    })
  }

  // 7. Investments — replayed from the tracker so each purchase and each mark posts on
  //    the date it actually happened, giving every company its own 1100-/1200- accounts
  //    and putting the 2025 year-end markups in the period they were earned.
  const replay = await replayInvestmentHistory(admin as any, fundId, group, userId, {})
  if ('error' in replay) {
    console.error(`[demo] ${group}: investment replay failed — ${replay.error}`)
  } else {
    console.log(`[demo] ${group}: replayed ${replay.entries} investment entries across ${replay.dates} dates`)
  }

  // 8. Close every month through year-end, allocating P&L to partners by commitment.
  const closed = await closeThrough(admin as any, fundId, group, userId, plan.closeThrough)
  if ('error' in closed) {
    console.error(`[demo] ${group}: close failed — ${closed.error}`)
  } else {
    console.log(`[demo] ${group}: closed ${closed.closed.length} periods through ${plan.closeThrough}`)
  }
}

// ---------------------------------------------------------------------------
// The LP snapshot, rewritten from the books
// ---------------------------------------------------------------------------

/**
 * The demo's LP snapshot was authored by hand before there was a ledger, so its NAVs
 * didn't agree with the tracker's marks. Rather than leave the Reconciliation page
 * showing an unexplainable variance, derive the snapshot FROM the closed ledger: each
 * partner's NAV is their capital account, and paid-in is what they actually contributed.
 *
 * This is only sound because the close allocates by commitment and the calls are also
 * pro-rata by commitment — so a partner's capital genuinely is their share of net assets.
 */
async function reconcileLpSnapshotToLedger(admin: Admin, fundId: string, group: string): Promise<void> {
  const { capitalPostings } = await loadPostedLedger(admin as any, fundId, group)
  const accounts = Array.from(computeCapitalAccounts(capitalPostings).entries())

  for (const [lpEntityId, acct] of accounts) {
    if (!lpEntityId) continue
    const paidIn = round2(acct.contributions)
    const distributions = round2(-acct.distributions)
    const nav = round2(acct.ending)
    if (paidIn <= 0) continue

    const { data: row } = await (admin as any)
      .from('lp_investments')
      .select('id, commitment')
      .eq('fund_id', fundId)
      .eq('portfolio_group', group)
      .eq('entity_id', lpEntityId)
      .maybeSingle()
    if (!row) continue

    const commitment = Number(row.commitment)
    await (admin as any)
      .from('lp_investments')
      .update({
        paid_in_capital: paidIn,
        called_capital: paidIn,
        outstanding_balance: round2(commitment - paidIn),
        distributions,
        nav,
        total_value: round2(nav + distributions),
        dpi: round2(distributions / paidIn),
        rvpi: round2(nav / paidIn),
        tvpi: round2((nav + distributions) / paidIn),
      })
      .eq('id', row.id)
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/** Clear any prior accounting rows for the fund, children before parents. */
async function wipe(admin: Admin, fundId: string): Promise<void> {
  const a = admin as any
  await a.from('allocation_results').delete().eq('fund_id', fundId)
  await a.from('allocation_runs').delete().eq('fund_id', fundId)
  await a.from('journal_postings').delete().eq('fund_id', fundId)
  await a.from('journal_entries').delete().eq('fund_id', fundId)
  await a.from('capital_call_lines').delete().eq('fund_id', fundId)
  await a.from('capital_calls').delete().eq('fund_id', fundId)
  await a.from('bank_transactions').delete().eq('fund_id', fundId)
  await a.from('fiscal_periods').delete().eq('fund_id', fundId)
  await a.from('partner_allocation_terms').delete().eq('fund_id', fundId)
  await a.from('commitment_events').delete().eq('fund_id', fundId)
  await a.from('chart_of_accounts').delete().eq('fund_id', fundId)
  await a.from('vehicle_accounting_settings').delete().eq('fund_id', fundId)
}

/**
 * Seed the demo fund's books. MUST run after `seedLpSnapshot` (capital accounts and
 * commitments reference `lp_entities`, which that seeder deletes and recreates) and
 * after the investment transactions exist (the ledger replays them).
 */
export async function seedAccounting(admin: Admin, fundId: string, userId: string | null): Promise<void> {
  await wipe(admin, fundId)

  for (const plan of PLANS) {
    await seedVehicle(admin, fundId, userId, plan)
    await reconcileLpSnapshotToLedger(admin, fundId, plan.group)
  }

  console.log('[demo] Seeded accounting books for Fund I and Fund II')
}
