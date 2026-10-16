// Accrued carried interest.
//
// THE IDEA. At each close, ask: "if the fund liquidated at today's NAV, what would the GP be
// entitled to?" That number is the TARGET accrual. Compare it to what has already been accrued,
// and post the difference. Because the target is recomputed from scratch every period, the
// accrual reverses on its own when NAV falls — no special case, no clawback logic.
//
// This is the hypothetical-liquidation method, and it is what ASC 946 expects. Without it every
// LP's NAV overstates what they would actually receive by the GP's share of the unrealized
// gain.
//
// IT IS AN EQUITY REALLOCATION, NOT AN EXPENSE. Dr each LP's capital, Cr the GP's capital.
// It never touches P&L and never touches cash — which is precisely why the close has to do it
// AFTER every other category has landed: carry is computed on the NAV that those allocations
// produce.

import { runWaterfall } from './waterfall.ts'
import { roundCents } from './ledger.ts'
import { preferredTarget, type DatedContribution, type PrefBase } from './hurdle.ts'
import { replayWaterfallState, waterfallTermsOf, type PriorDistribution } from './replay.ts'

export { preferredTarget } from './hurdle.ts'
export type { DatedContribution, HurdleReduction, PrefBase } from './hurdle.ts'

export type CarryKind = 'none' | 'straight' | 'american' | 'european'

export interface CarryRecipient {
  lpEntityId: string
  /** Share of the accrued carry, 0–100. The set sums to 100. */
  pct: number
}

export interface VehicleCarryTerms {
  kind: CarryKind
  carryRate: number
  prefRate: number
  catchupRate: number
  /** How much of a full catch-up the GP gets, 0–1 (waterfall.ts). Absent means 1. */
  catchupSize?: number
  prefCompounds: boolean
  /** What the hurdle accrues on (hurdle.ts). Absent means 'contributed', the original reading. */
  prefBase?: PrefBase
  /** Single-recipient legacy field; kept for back-compat and as the fallback source. */
  gpEntityId: string | null
  /** Who receives the carry and in what split. Resolved from `carry_recipients`, or
   *  `[{ gpEntityId, 100 }]` when only the legacy field is set, else []. */
  recipients: CarryRecipient[]
}

export const NO_CARRY: VehicleCarryTerms = {
  kind: 'none',
  carryRate: 0,
  prefRate: 0,
  catchupRate: 1,
  catchupSize: 1,
  prefCompounds: true,
  prefBase: 'contributed',
  gpEntityId: null,
  recipients: [],
}

/** Resolve the carry recipients: the explicit list if present, else the legacy single GP at 100%. */
export function resolveCarryRecipients(carryRecipients: unknown, gpEntityId: string | null): CarryRecipient[] {
  if (Array.isArray(carryRecipients)) {
    const list = carryRecipients
      .filter((r): r is { lpEntityId: string; pct: unknown } => !!r && typeof r.lpEntityId === 'string')
      .map(r => ({ lpEntityId: r.lpEntityId, pct: Number(r.pct) }))
      .filter(r => Number.isFinite(r.pct) && r.pct > 0)
    if (list.length > 0) return list
  }
  return gpEntityId ? [{ lpEntityId: gpEntityId, pct: 100 }] : []
}

/** One LP's economics, as at the accrual date. All from the ledger. */
export interface LpEconomics {
  lpEntityId: string
  /** Cumulative capital contributed (positive). */
  contributed: number
  /** Cumulative distributions received (positive). */
  distributed: number
  /**
   * Capital account balance BEFORE any carry accrual: today's balance with the carry already
   * debited from this LP added back. The target is what the GP would take from the LPs' gross
   * value; measuring it on a balance already net of carry counts the carry twice.
   */
  nav: number
}

export interface CarryTargetInput {
  lps: LpEconomics[]
  /** Dated LP contributions, for the preferred-return accrual. European/American. */
  contributions?: DatedContribution[]
  /** The date the accrual is measured at. European/American. */
  asOf?: string
  /**
   * Every prior distribution as a fund-wide total per date. Needed only when the hurdle accrues on
   * unreturned capital, because then what came back, and when, shrinks the hurdle.
   */
  distributions?: PriorDistribution[]
}

/**
 * The GP's TOTAL carry entitlement if the fund liquidated at today's NAV.
 *
 * Not the amount to post — that is this minus whatever is already accrued. See `carryAccrual`.
 */
export function carryTarget(input: CarryTargetInput, terms: VehicleCarryTerms): number {
  if (terms.kind === 'none' || terms.carryRate <= 0) return 0

  const contributed = roundCents(input.lps.reduce((s, l) => s + l.contributed, 0))
  const distributed = roundCents(input.lps.reduce((s, l) => s + l.distributed, 0))
  const nav = roundCents(input.lps.reduce((s, l) => s + l.nav, 0))

  // What the LPs would hold in total if we sold everything today.
  const liquidation = roundCents(nav + distributed)

  if (terms.kind === 'straight') {
    // Profit over contributed capital, GP takes its rate. No pref, no catch-up.
    const profit = roundCents(liquidation - contributed)
    if (profit <= 0) return 0
    return roundCents(profit * terms.carryRate)
  }

  // European (whole-fund) AND American (deal-by-deal) accrue the SAME target here.
  //
  // American doesn't earn the GP MORE carry than European — it earns the same total, just PAID
  // earlier (as individual deals realize), with a clawback that pulls back any carry later deals
  // prove was overpaid. Since this close accrues carry as-if-liquidated-at-today's-NAV — i.e. the
  // GP's ULTIMATE entitlement — and the clawback makes that ultimate total identical to European,
  // the prudent accrued MARK is the whole-fund result for both. (Accruing a deal-by-deal "winners
  // only" figure would overstate the GP and understate LP NAV.) The genuine American difference —
  // distributing realized carry cash per deal before the whole fund is made whole — is a
  // distribution-timing concern, not an accrual one: it is how `splitDistribution` splits an
  // American distribution (replay.ts). A liquidation realizes every deal, so here the deal-by-deal
  // capital base IS the whole fund. Run the real waterfall on the hypothetical liquidation.
  const asOf = input.asOf ?? new Date(0).toISOString().slice(0, 10)
  const contributions = input.contributions ?? []
  // On an unreturned base the hurdle depends on what the actual distributions returned and paid,
  // so replay them (whole-fund: the liquidation realizes every deal) and read its hurdle.
  const pref = terms.prefBase === 'unreturned'
    ? replayWaterfallState(input.distributions ?? [], contributions, { ...terms, kind: 'european' }, asOf).preferredTarget
    : preferredTarget(contributions, asOf, terms.prefRate, terms.prefCompounds)

  const result = runWaterfall(liquidation, waterfallTermsOf(terms), {
    contributedCapital: contributed,
    returnedCapital: 0,
    preferredPaid: 0,
    preferredTarget: pref,
    gpCarryPaid: 0,
  })

  // Everything the GP takes across the catch-up and carry tiers.
  return roundCents(result.toCatchUp + result.toCarryGP)
}

/**
 * Normalize a stored terms row (the `vehicle_waterfall_terms` columns, snake_case) into
 * `VehicleCarryTerms`. An absent row is no carry, which is the only safe default: accruing carry
 * nobody agreed to is worse than accruing none. An unrecognised `kind` is also no carry.
 */
export function carryTermsFromRow(row: {
  kind?: unknown
  carry_rate?: unknown
  pref_rate?: unknown
  catchup_rate?: unknown
  catchup_size?: unknown
  pref_compounds?: unknown
  pref_base?: unknown
  gp_entity_id?: unknown
  carry_recipients?: unknown
} | null | undefined): VehicleCarryTerms {
  if (!row) return NO_CARRY
  const kind: CarryKind =
    row.kind === 'straight' || row.kind === 'american' || row.kind === 'european' ? row.kind : 'none'
  const gpEntityId = (row.gp_entity_id ?? null) as string | null

  return {
    kind,
    carryRate: Number(row.carry_rate ?? 0),
    prefRate: Number(row.pref_rate ?? 0),
    catchupRate: Number(row.catchup_rate ?? 1),
    catchupSize: row.catchup_size == null ? 1 : Number(row.catchup_size),
    prefCompounds: row.pref_compounds !== false,
    prefBase: row.pref_base === 'unreturned' ? 'unreturned' : 'contributed',
    gpEntityId,
    recipients: resolveCarryRecipients(row.carry_recipients, gpEntityId),
  }
}

export interface CarryAccrual {
  /** Total entitlement at today's NAV. */
  target: number
  /** What is already sitting in the GP's carriedInterest bucket. */
  alreadyAccrued: number
  /** What to post. Negative = a reversal, because NAV fell. */
  delta: number
  /** Per-LP debit. Positive reduces that LP's capital. Sums to `delta`. */
  perLp: Map<string, number>
}

/**
 * What this period's close should post.
 *
 * The debit is shared across LPs in proportion to each one's PROFIT — carry is a share of
 * gains, so an LP sitting on a loss does not pay it, and an LP with twice the gain pays twice
 * as much. When the accrual REVERSES (NAV fell), the reversal is shared the same way, so it
 * unwinds along the path it was built.
 *
 * If nobody is in profit there is nothing to take carry from, and the target is zero anyway.
 */
export function carryAccrual(
  input: CarryTargetInput,
  terms: VehicleCarryTerms,
  alreadyAccrued: number
): CarryAccrual {
  const target = carryTarget(input, terms)
  const delta = roundCents(target - alreadyAccrued)
  const perLp = new Map<string, number>()

  if (delta === 0) return { target, alreadyAccrued, delta: 0, perLp }

  // Each LP's gain, measured the same way the target was: value today plus what they've taken
  // out, less what they put in.
  const profits = input.lps
    .map(l => ({ lpEntityId: l.lpEntityId, profit: roundCents(l.nav + l.distributed - l.contributed) }))
    .filter(p => p.profit > 0)

  const totalProfit = roundCents(profits.reduce((s, p) => s + p.profit, 0))
  if (totalProfit <= 0) {
    // No one is in profit. A positive target can't be sourced from anybody; a reversal has
    // nothing left to reverse against.
    return { target, alreadyAccrued, delta: 0, perLp }
  }

  // Largest-remainder, so the per-LP debits sum EXACTLY to delta and no cent is invented.
  let allocated = 0
  const shares = profits.map(p => ({ ...p, exact: (delta * p.profit) / totalProfit }))
  const rounded = shares.map(s => ({ ...s, amount: roundCents(s.exact) }))
  allocated = roundCents(rounded.reduce((s, r) => s + r.amount, 0))

  const drift = roundCents(delta - allocated)
  if (drift !== 0 && rounded.length > 0) {
    // Put the odd cent on the largest share — the conventional tiebreak.
    const biggest = rounded.reduce((a, b) => (Math.abs(b.exact) > Math.abs(a.exact) ? b : a))
    biggest.amount = roundCents(biggest.amount + drift)
  }

  for (const r of rounded) {
    if (r.amount !== 0) perLp.set(r.lpEntityId, r.amount)
  }

  return { target, alreadyAccrued, delta, perLp }
}
