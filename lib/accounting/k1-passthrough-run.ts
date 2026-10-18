// Lower-tier K-1 amounts → posted tax-book entries: the loader and the run.
//
// k1-passthrough.ts decides what each holding's K-1 posts; this reads what it needs (the recorded
// amounts, the book gain to reverse, the partners' weights) and writes the result. Same posture as
// book-tax-run.ts, which calls it, so one "post the tax adjustments" does both:
//
//   * PREVIEW AND POST RUN THE SAME CODE. `preview` only decides whether anything is written.
//   * RE-RUNNABLE. Every entry for a holding carries `source_ref = tax-k1:<year>:<company>`; a post
//     voids every live entry for the year with that prefix first, then writes the current set. A
//     holding whose amounts were cleared therefore loses its entries on the next run instead of
//     keeping stale ones.
//   * HAND ENTRIES ARE NEVER TOUCHED. A preparer's own tax-book entry has no such source_ref. When
//     one already touches a holding's accounts in the year the holding is flagged, because the two
//     together would likely count the K-1 twice — but nothing is voided on a guess.
//   * A CLOSED TAX YEAR IS REFUSED up front, with the reason; the database trigger
//     (assert_tax_year_open_for) is the boundary and this is the friendlier message.

import type { SupabaseClient } from '@supabase/supabase-js'
import { roundCents } from './ledger'
import { ACTUAL_BOOK } from './books'
import { fetchAllRows, loadPostedLedger } from './load'
import { accountIdByCode, ensureCapitalAccounts, persistEntry } from './persist'
import { vehicleIdByName } from './vehicle-id'
import { vehicleKindByName } from './vehicle-domain'
import { closesToOwnerEquity } from '@/lib/vehicle-kinds'
import { keepsRetainedEarnings } from './statements'
import { computeCapitalAccounts } from './capital-account'
import { allocationWeights, loadAllocationBasis, loadPartnerTerms, loadResolvedCommitments } from './terms'
import { PASS_THROUGH_BASIS_SUBTYPE, PASS_THROUGH_CHART, passThroughBasisCode } from './chart'
import {
  buildPassThroughDrafts,
  passThroughSourceRef,
  passThroughSourceRefPrefix,
  PASS_THROUGH_ALLOCATION_CATEGORY,
  PASS_THROUGH_SLOTS,
  type AccountRef,
  type PassThroughBucket,
  type PassThroughCapitalSide,
  type PassThroughDraft,
  type PassThroughLine,
} from './k1-passthrough'
import { K1_EXPECTED_HOLDING_TYPE } from '@/lib/tax/received-k1s'
import { amountsFromRow, itemLVariance, receivedK1AmountProblems, type ReceivedK1Amounts } from '@/lib/tax/received-k1-amounts'
import type { JournalEntry, Posting } from './types'

const BRIDGE_CODE = '3200'

export interface PassThroughHolding {
  companyId: string
  companyName: string
  status: string
  amounts: ReceivedK1Amounts
  /** Each postable box, with the account it goes to. */
  lines: (PassThroughLine & { accountCode: string; accountName: string })[]
  /** The actual book's realized gain on the holding in the year, reversed in the tax book. */
  bookRealizedGainReversed: number
  /** Net movement on the holding's tax basis from this K-1. */
  basisChange: number
  /** Box 19 as reported, against the distributions the register recorded for the year. */
  distributions: { reported: number | null; recorded: number; difference: number | null }
  /**
   * The holding's tax basis after this run (cost plus every tax-book adjustment), against Item L's
   * ending capital as reported. Informational: Item L excludes the share of the lower tier's
   * liabilities that outside basis includes, so a difference is expected wherever it has debt.
   */
  basisTieOut: { derived: number; reportedEndingCapital: number | null; difference: number | null }
  /** Item L's own foot as typed, or null when it was not entered in full. */
  itemLVariance: number | null
  /** Hand-authored tax-book entries in the year that already touch this holding's accounts. */
  handEntries: number
  warnings: string[]
  /** Set when nothing is posted for this holding, with the reason. */
  skipped?: string
}

export interface PassThroughRunResult {
  taxYear: number
  holdings: PassThroughHolding[]
  /** Holdings whose K-1 is marked received but whose amounts nobody has entered yet. */
  awaitingAmounts: { companyId: string; companyName: string }[]
  /** Entry ids written. Empty on a preview. */
  entryIds: string[]
  /** Pass-through entries from a previous run of this year that were voided first. */
  voided: number
}

interface ChartRow { id: string; code: string; name: string; type: string; subtype: string | null; company_id: string | null; lp_entity_id: string | null }

/** Is the tax year closed for this vehicle? */
export async function taxYearClosed(admin: SupabaseClient, fundId: string, vehicleId: string, taxYear: number): Promise<boolean> {
  const { data } = await admin
    .from('tax_year_closes' as any)
    .select('status')
    .eq('fund_id', fundId)
    .eq('vehicle_id', vehicleId)
    .eq('tax_year', taxYear)
    .maybeSingle()
  return (data as any)?.status === 'closed'
}

/**
 * Derive (and, unless previewing, post) the tax-book entries for every lower-tier K-1 this vehicle
 * has recorded amounts for in `taxYear`.
 */
export async function postPassThroughAdjustments(
  admin: SupabaseClient,
  fundId: string,
  group: string,
  userId: string | null,
  taxYear: number,
  opts?: { preview?: boolean; entryDate?: string },
): Promise<PassThroughRunResult | { error: string }> {
  const vehicleId = await vehicleIdByName(admin, fundId, group)
  if (!vehicleId) return { error: `Unknown vehicle "${group}"` }
  const preview = opts?.preview === true
  if (!preview && await taxYearClosed(admin, fundId, vehicleId, taxYear)) {
    return { error: `Tax year ${taxYear} is closed. Reopen it on the Tax page (a reason is required) before posting K-1 pass-through entries.` }
  }

  const yearStart = `${taxYear}-01-01`
  const yearEnd = `${taxYear}-12-31`
  const entryDate = opts?.entryDate ?? yearEnd
  const prefix = passThroughSourceRefPrefix(taxYear)

  // --- Which K-1s ------------------------------------------------------------
  // THIS vehicle's fund holdings, filtered on the discriminator in SQL (holding-type.test.ts).
  const [{ data: holdingRows }, { data: k1Rows }] = await Promise.all([
    admin
      .from('companies' as any)
      .select('id, name, portfolio_group')
      .eq('fund_id', fundId)
      .eq('holding_type', K1_EXPECTED_HOLDING_TYPE)
      .contains('portfolio_group', [group]),
    admin
      .from('received_k1s' as any)
      .select('*')
      .eq('fund_id', fundId)
      .eq('tax_year', taxYear),
  ])
  const holdings = new Map(((holdingRows as any[]) ?? []).map(h => [h.id as string, h]))

  // A row recorded for this vehicle wins over an older one recorded without a vehicle. A row with no
  // vehicle counts only for a holding no other vehicle holds: otherwise two vehicles would each post
  // the same K-1, and the second would double the first.
  const rowByCompany = new Map<string, any>()
  const unscoped: string[] = []
  for (const r of ((k1Rows as any[]) ?? [])) {
    const h = holdings.get(r.company_id)
    if (!h) continue
    if (r.vehicle_id && r.vehicle_id !== vehicleId) continue
    if (!r.vehicle_id) {
      const groups = Array.isArray(h.portfolio_group) ? h.portfolio_group : [h.portfolio_group]
      if (groups.filter(Boolean).length > 1) { unscoped.push(r.company_id); continue }
      if (rowByCompany.has(r.company_id)) continue
    }
    rowByCompany.set(r.company_id, r)
  }

  const out: PassThroughHolding[] = []
  const awaitingAmounts: { companyId: string; companyName: string }[] = []
  const candidates: { companyId: string; name: string; status: string; amounts: ReceivedK1Amounts }[] = []
  for (const [companyId, r] of Array.from(rowByCompany.entries())) {
    if (r.status !== 'received' && r.status !== 'amended') continue
    const name = holdings.get(companyId)?.name ?? companyId
    const amounts = amountsFromRow(r)
    if (!amounts) { awaitingAmounts.push({ companyId, companyName: name }); continue }
    candidates.push({ companyId, name, status: r.status, amounts })
  }
  for (const companyId of unscoped) {
    const name = holdings.get(companyId)?.name ?? companyId
    out.push(emptyHolding(companyId, name, 'received', {},
      'This holding sits in more than one entity and its K-1 was recorded without saying which received it. Record it again against this entity.'))
  }

  // --- The chart, and the book activity on each holding -----------------------
  const chart = await fetchAllRows<ChartRow>((from, to) => admin
    .from('chart_of_accounts' as any)
    .select('id, code, name, type, subtype, company_id, lp_entity_id')
    .eq('fund_id', fundId)
    .eq('vehicle_id', vehicleId)
    .order('id')
    .range(from, to) as any)
  const candidateIds = new Set(candidates.map(c => c.companyId))
  const companyAccounts = chart.filter(a => a.company_id && candidateIds.has(a.company_id))
  const realizedIds = new Set(companyAccounts.filter(a => a.type === 'income' && a.subtype === 'realized_gain').map(a => a.id))
  const assetIds = new Set(companyAccounts.filter(a => a.type === 'asset').map(a => a.id))
  const companyOf = new Map(companyAccounts.map(a => [a.id, a.company_id as string]))

  // Both books, stated in the query (books.test.ts): the gain to reverse is actual-book, the basis
  // tie-out is actual plus tax, and hand entries are found in the tax book.
  const watched = Array.from(new Set([...Array.from(realizedIds), ...Array.from(assetIds)]))
  const postingRows = watched.length === 0 ? [] : await fetchAllRows<any>((from, to) => admin
    .from('journal_postings' as any)
    .select('id, journal_entry_id, account_id, amount, journal_entries!inner(entry_date, status, book, source_ref)')
    .in('book', [ACTUAL_BOOK, 'tax'])
    .eq('fund_id', fundId)
    .eq('vehicle_id', vehicleId)
    .in('account_id', watched)
    .order('id')
    .range(from, to))

  const bookGainByAccount = new Map<string, Map<string, number>>() // company → realized account → gain
  const basisBefore = new Map<string, number>()
  const handEntries = new Map<string, Set<string>>()
  for (const r of postingRows) {
    const e = r.journal_entries
    if (e?.status !== 'posted') continue
    const companyId = companyOf.get(r.account_id)
    if (!companyId) continue
    const amount = Number(r.amount)
    const ref: string = e.source_ref ?? ''
    const inYear = e.entry_date >= yearStart && e.entry_date <= yearEnd
    if (e.book === ACTUAL_BOOK && inYear && realizedIds.has(r.account_id)) {
      const m = bookGainByAccount.get(companyId) ?? new Map<string, number>()
      // Income is a credit: a gain arrives negative, so the gain is the negation.
      m.set(r.account_id, roundCents((m.get(r.account_id) ?? 0) - amount))
      bookGainByAccount.set(companyId, m)
    }
    // This run's own previous entries are about to be replaced, so they are not part of "before".
    const ownPrior = e.book === 'tax' && ref.startsWith(prefix)
    if (assetIds.has(r.account_id) && e.entry_date <= yearEnd && !ownPrior) {
      basisBefore.set(companyId, roundCents((basisBefore.get(companyId) ?? 0) + amount))
    }
    if (e.book === 'tax' && inYear && !ref.startsWith('tax:') && !ref.startsWith('tax-k1:')) {
      const s = handEntries.get(companyId) ?? new Set<string>()
      s.add(r.journal_entry_id)
      handEntries.set(companyId, s)
    }
  }

  // Distributions the register recorded for the year, against box 19.
  const recordedDistributions = new Map<string, number>()
  if (candidateIds.size > 0) {
    const { data: proceeds } = await admin
      .from('investment_transactions' as any)
      .select('company_id, proceeds_received, transaction_date')
      .eq('fund_id', fundId)
      .eq('transaction_type', 'proceeds')
      .eq('portfolio_group', group)
      .in('company_id', Array.from(candidateIds))
      .gte('transaction_date', yearStart)
      .lte('transaction_date', yearEnd)
    for (const p of ((proceeds as any[]) ?? [])) {
      recordedDistributions.set(p.company_id, roundCents((recordedDistributions.get(p.company_id) ?? 0) + Number(p.proceeds_received ?? 0)))
    }
  }

  // --- The capital side ------------------------------------------------------
  let capital: PassThroughCapitalSide = { mode: 'none' }
  let ownerCapitalId: string | null = null
  let capitalProblem: string | null = null
  if (candidates.length > 0) {
    const kind = await vehicleKindByName(admin, fundId, group)
    if (closesToOwnerEquity(kind)) {
      if (keepsRetainedEarnings(chart.map(a => ({ subtype: a.subtype ?? undefined })) as any)) {
        capital = { mode: 'none' }
      } else {
        ownerCapitalId = chart.find(a => a.subtype === 'members_capital')?.id ?? null
        if (!ownerCapitalId) capitalProblem = 'No owner capital account is configured.'
        capital = { mode: 'owner' }
      }
    } else {
      // The same basis the actual book's allocation uses, as of the entry date (continuous-allocation.ts).
      const [basis, terms] = await Promise.all([loadAllocationBasis(admin, fundId, group), loadPartnerTerms(admin, fundId, group)])
      let basisAmounts: { lpEntityId: string; basisAmount: number }[]
      if (basis === 'capital_balance') {
        const { capitalPostings } = await loadPostedLedger(admin, fundId, group, entryDate)
        basisAmounts = Array.from(computeCapitalAccounts(capitalPostings, { end: entryDate }), ([lpEntityId, a]) => ({ lpEntityId, basisAmount: a.ending }))
      } else {
        basisAmounts = Array.from(await loadResolvedCommitments(admin, fundId, group, entryDate), ([lpEntityId, basisAmount]) => ({ lpEntityId, basisAmount: Number(basisAmount) }))
      }
      const positive = basisAmounts.filter(b => b.basisAmount > 0)
      const weightsFor = (bucket: PassThroughBucket) => allocationWeights(positive, terms, PASS_THROUGH_ALLOCATION_CATEGORY[bucket])
      capital = { mode: 'partners', weights: { income: weightsFor('income'), gain: weightsFor('gain'), deduction: weightsFor('deduction') } }
    }
  }

  // --- Derive ----------------------------------------------------------------
  const codeForSlot = (subtype: string) => {
    const existing = chart.filter(a => a.subtype === subtype && !a.company_id).sort((a, b) => a.code.localeCompare(b.code))[0]
    const seed = PASS_THROUGH_CHART.find(s => s.subtype === subtype)!
    return { code: existing?.code ?? seed.code, name: existing?.name ?? seed.name }
  }
  const built = new Map<string, PassThroughDraft[]>()
  for (const c of candidates) {
    const gains = bookGainByAccount.get(c.companyId) ?? new Map<string, number>()
    const bookRealizedGain = roundCents(Array.from(gains.values()).reduce((s, v) => s + v, 0))
    const problems = receivedK1AmountProblems(c.amounts)
    const result = problems.length > 0 || capitalProblem
      ? null
      : buildPassThroughDrafts({ taxYear, holdingName: c.name, amounts: c.amounts, bookRealizedGain, capital })

    const warnings: string[] = []
    const reportedDist = c.amounts.distributionsCash !== undefined || c.amounts.distributionsProperty !== undefined
      ? roundCents((c.amounts.distributionsCash ?? 0) + (c.amounts.distributionsProperty ?? 0)) : null
    const recorded = recordedDistributions.get(c.companyId) ?? 0
    const distDiff = reportedDist === null ? null : roundCents(reportedDist - recorded)
    if (distDiff !== null && Math.abs(distDiff) >= 1) {
      warnings.push(`The K-1 reports ${reportedDist!.toFixed(2)} of distributions (box 19); the register recorded ${recorded.toFixed(2)} for ${taxYear}. A distribution may be missing from the books, or dated in another year.`)
    }
    const hand = handEntries.get(c.companyId)?.size ?? 0
    if (hand > 0) {
      warnings.push(`${hand} hand-authored tax-book ${hand === 1 ? 'entry' : 'entries'} in ${taxYear} already touch this holding. If they book this K-1, void them before posting, or it will be counted twice.`)
    }
    const variance = itemLVariance(c.amounts)
    if (variance !== null && Math.abs(variance) >= 1) {
      warnings.push(`Item L does not foot as entered (off by ${variance.toFixed(2)}). Check the capital account lines against the K-1.`)
    }
    if (c.amounts.guaranteedPayments) {
      warnings.push('Guaranteed payments (box 4) are reported on this fund’s own K-1s as ordinary business income (box 1). Reclassify by hand if they belong elsewhere.')
    }
    const basisChange = result?.basisChange ?? 0
    const derived = roundCents((basisBefore.get(c.companyId) ?? 0) + basisChange)
    const reportedEnding = c.amounts.capitalEnding ?? null
    out.push({
      companyId: c.companyId,
      companyName: c.name,
      status: c.status,
      amounts: c.amounts,
      lines: (result?.lines ?? []).map(l => ({ ...l, accountCode: codeForSlot(PASS_THROUGH_SLOTS[l.slot].subtype).code, accountName: codeForSlot(PASS_THROUGH_SLOTS[l.slot].subtype).name })),
      bookRealizedGainReversed: result ? bookRealizedGain : 0,
      basisChange,
      distributions: { reported: reportedDist, recorded, difference: distDiff },
      basisTieOut: { derived, reportedEndingCapital: reportedEnding, difference: reportedEnding === null ? null : roundCents(reportedEnding - derived) },
      itemLVariance: variance,
      handEntries: hand,
      warnings,
      skipped: problems.length > 0 ? problems.join(' ') : capitalProblem ?? result?.skipped,
    })
    if (result && !result.skipped && result.drafts.length > 0) built.set(c.companyId, result.drafts)
  }
  out.sort((a, b) => a.companyName.localeCompare(b.companyName))

  if (preview) return { taxYear, holdings: out, awaitingAmounts, entryIds: [], voided: 0 }

  // --- Post ------------------------------------------------------------------
  let resolved: Map<string, JournalEntry[]>
  try {
    resolved = await resolveDrafts(admin, fundId, group, vehicleId, chart, built, holdings, bookGainByAccount, ownerCapitalId, entryDate)
  } catch (e) {
    return { error: (e as Error).message }
  }

  const voided = await voidPriorPassThrough(admin, fundId, vehicleId, taxYear)
  const entryIds: string[] = []
  for (const [companyId, entries] of Array.from(resolved.entries())) {
    for (const entry of entries) {
      const result = await persistEntry(admin, fundId, group, userId, { ...entry, sourceRef: passThroughSourceRef(taxYear, companyId) }, 'posted', 'tax')
      if ('error' in result) return { error: result.error }
      entryIds.push(result.entryId)
    }
  }
  return { taxYear, holdings: out, awaitingAmounts, entryIds, voided }
}

function emptyHolding(companyId: string, companyName: string, status: string, amounts: ReceivedK1Amounts, skipped: string): PassThroughHolding {
  return {
    companyId, companyName, status, amounts, lines: [], bookRealizedGainReversed: 0, basisChange: 0,
    distributions: { reported: null, recorded: 0, difference: null },
    basisTieOut: { derived: 0, reportedEndingCapital: null, difference: null },
    itemLVariance: null, handEntries: 0, warnings: [], skipped,
  }
}

/**
 * Turn drafts into entries with account ids, creating the accounts they need.
 *
 * Accounts are created only here, on a post: a preview writes nothing. The character accounts are
 * found by subtype, so a chart that already has them under other codes keeps using its own.
 */
async function resolveDrafts(
  admin: SupabaseClient,
  fundId: string,
  group: string,
  vehicleId: string,
  chart: ChartRow[],
  built: Map<string, PassThroughDraft[]>,
  holdings: Map<string, any>,
  bookGainByAccount: Map<string, Map<string, number>>,
  ownerCapitalId: string | null,
  entryDate: string,
): Promise<Map<string, JournalEntry[]>> {
  const out = new Map<string, JournalEntry[]>()
  if (built.size === 0) return out

  const codes = await accountIdByCode(admin, fundId, group)
  const bridgeId = codes.get(BRIDGE_CODE)
  const needsBridge = Array.from(built.values()).some(ds => ds.some(d => d.postings.some(p => p.account.kind === 'bridge')))
  if (needsBridge && !bridgeId) {
    throw new Error(`The chart is missing account ${BRIDGE_CODE} Undistributed earnings — add it under the entity's Admin → Chart of accounts.`)
  }

  // Character accounts, by subtype; created on first use.
  const slotIds = new Map<string, string>()
  for (const a of chart) if (a.subtype && !a.company_id && !slotIds.has(a.subtype)) slotIds.set(a.subtype, a.id)
  const haveCodes = new Set(chart.map(a => a.code))
  const missingSeeds = PASS_THROUGH_CHART.filter(s => !slotIds.has(s.subtype!) && !haveCodes.has(s.code))
  const clashing = PASS_THROUGH_CHART.filter(s => !slotIds.has(s.subtype!) && haveCodes.has(s.code))
  if (clashing.length > 0) {
    throw new Error(`The chart already uses ${clashing.map(s => s.code).join(', ')} for other accounts, so the K-1 pass-through accounts cannot be created there. Add accounts with subtypes ${clashing.map(s => s.subtype).join(', ')} under other codes.`)
  }
  if (missingSeeds.length > 0) {
    const { data: created, error } = await admin.from('chart_of_accounts' as any).insert(missingSeeds.map(s => ({
      fund_id: fundId, portfolio_group: group, vehicle_id: vehicleId,
      code: s.code, name: s.name, type: s.type, subtype: s.subtype,
    }))).select('id, subtype')
    if (error) throw new Error(`Could not add the K-1 pass-through accounts: ${error.message}`)
    for (const a of ((created as any[]) ?? [])) slotIds.set(a.subtype, a.id)
  }

  // Per-holding basis accounts (1700-<company>).
  const basisIds = new Map<string, string>()
  for (const a of chart) if (a.company_id && a.subtype === PASS_THROUGH_BASIS_SUBTYPE) basisIds.set(a.company_id, a.id)
  const missingBasis = Array.from(built.keys()).filter(id => !basisIds.has(id))
  if (missingBasis.length > 0) {
    const { data: created, error } = await admin.from('chart_of_accounts' as any).insert(missingBasis.map(id => ({
      fund_id: fundId, portfolio_group: group, vehicle_id: vehicleId,
      code: passThroughBasisCode(id), name: `Pass-through basis — ${holdings.get(id)?.name ?? id}`,
      type: 'asset', subtype: PASS_THROUGH_BASIS_SUBTYPE, company_id: id,
    }))).select('id, company_id')
    if (error) throw new Error(`Could not add the holdings' pass-through basis accounts: ${error.message}`)
    for (const a of ((created as any[]) ?? [])) basisIds.set(a.company_id, a.id)
  }

  const lpIds = new Set<string>()
  for (const ds of Array.from(built.values())) for (const d of ds) for (const p of d.postings) if (p.account.kind === 'capital') lpIds.add(p.account.lpEntityId)
  const capMap = lpIds.size > 0 ? await ensureCapitalAccounts(admin, fundId, group, Array.from(lpIds)) : new Map<string, string>()

  for (const [companyId, drafts] of Array.from(built.entries())) {
    const entries: JournalEntry[] = []
    for (const d of drafts) {
      const postings: Posting[] = []
      for (const p of d.postings) {
        const lpEntityId = p.lpEntityId ?? null
        const ref: AccountRef = p.account
        if (ref.kind === 'bookRealized') {
          // Each realized account by its own share, so each one's gain is reversed where it was booked.
          const gains = Array.from((bookGainByAccount.get(companyId) ?? new Map<string, number>()).entries()).filter(([, g]) => g !== 0)
          const total = roundCents(gains.reduce((s, [, g]) => s + g, 0))
          if (gains.length === 0 || total !== p.amount) throw new Error('The book gain to reverse changed while the run was building. Run it again.')
          for (const [accountId, g] of gains) postings.push({ accountId, amount: g, currency: 'USD', lpEntityId: null })
          continue
        }
        const accountId =
          ref.kind === 'slot' ? slotIds.get(PASS_THROUGH_SLOTS[ref.slot].subtype)
          : ref.kind === 'basis' ? basisIds.get(companyId)
          : ref.kind === 'bridge' ? bridgeId
          : ref.kind === 'owner' ? ownerCapitalId ?? undefined
          : capMap.get(ref.lpEntityId)
        if (!accountId) throw new Error(`No account to post the ${ref.kind} line of ${holdings.get(companyId)?.name ?? companyId}'s K-1 to.`)
        postings.push({ accountId, amount: p.amount, currency: 'USD', lpEntityId })
      }
      entries.push({ fundId, entryDate, memo: d.memo, sourceType: d.sourceType, postings })
    }
    out.set(companyId, entries)
  }
  return out
}

/**
 * Void this year's previously-generated pass-through entries for the vehicle.
 *
 * Voided, not deleted, and scoped by source_ref prefix — so a preparer's hand-authored tax entry
 * survives a re-run untouched, exactly as voidPriorTaxRun leaves them alone.
 */
export async function voidPriorPassThrough(
  admin: SupabaseClient,
  fundId: string,
  vehicleId: string,
  taxYear: number,
): Promise<number> {
  const { data } = await admin
    .from('journal_entries' as any)
    .select('id')
    .eq('book', 'tax')
    .eq('fund_id', fundId)
    .eq('vehicle_id', vehicleId)
    .like('source_ref', `${passThroughSourceRefPrefix(taxYear)}%`)
    .eq('status', 'posted')
  const ids = ((data as any[]) ?? []).map(r => r.id as string)
  if (ids.length === 0) return 0
  await admin.from('journal_entries' as any).update({ status: 'void' }).in('id', ids)
  return ids.length
}
