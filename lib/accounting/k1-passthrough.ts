// A lower-tier K-1 → tax-book entries. Pure: no database, no chart lookups.
//
// A fund that holds another fund is a partner in it, and for tax it is taxed on its SHARE of that
// fund's income, by character, whether or not anything was distributed. The actual book cannot say
// so: it carries the holding at fair value (or cost), books distributions against cost and gain, and
// never sees the K-1. So the K-1 is a book-to-tax difference, and it belongs in the tax book —
// exactly what a preparer used to post by hand at year end, one holding at a time.
//
// WHAT ONE HOLDING'S K-1 POSTS (all in book 'tax', dated the last day of the tax year):
//
//   1. Its income, by character. Dr the holding's basis account (1700-<company>), Cr the holding's
//      own account for each character (4610-<company> under 4610, …; chart.ts PASS_THROUGH_CHART
//      holds the parents); deductions the other way (Dr 5970-<company>, Cr basis). The holding's tax
//      basis goes up by its share of income and down by its share of loss and deduction, which is
//      the §705 adjustment.
//
//   2. The capital side of the same amounts, so each PARTNER's tax capital carries it too: Dr 3200
//      Undistributed earnings, Cr each partner's capital by the vehicle's allocation weights — the
//      compound form ACCOUNTING.md describes for the actual book. One entry per bucket (income,
//      gain, deduction) because a capital posting's roll-forward line comes from its entry's
//      source_type, and the fund's K-1 allocation splits character by those lines (k1-allocation).
//
//   3. The reversal of the book gain the K-1 replaces. The actual book recognises gain when a
//      distribution from the holding exceeds the cost it retires; for tax a distribution only
//      reduces basis (§731), and the income is whatever the K-1 says. So the year's realized gain
//      on the holding's own realized account is reversed (Dr 4000-<company>, Cr basis), with the
//      matching capital side. Left in, the fund would report that gain AND the K-1's.
//
// NOT HERE, deliberately (see the notes in ACCOUNTING.md): a distribution in excess of basis
// (§731(a) gain), a share of the lower tier's liabilities (§752, Item K), §1061 three-year
// information (box 20 code AH), and every box 20 code. Each needs facts the K-1's face does not
// give or a judgment this cannot make; they stay hand-authored tax entries.

import { roundCents, assertBalanced } from './ledger'
import { allocateAmount } from './allocation'
import type { ReceivedK1Amounts } from '@/lib/tax/received-k1-amounts'
import type { FundYearCharacter, K1Category } from './k1-allocation'
import { PASS_THROUGH_CHARACTER_SUBTYPES } from './chart'

/** One line of pass-through, by the account it posts to. */
export type PassThroughSlot =
  | 'ordinary'
  | 'rentalRealEstate'
  | 'otherRental'
  | 'guaranteedPayments'
  | 'interest'
  | 'dividends'
  | 'qualifiedDividends'
  | 'royalties'
  | 'shortTermGain'
  | 'longTermGain'
  | 'section1231Gain'
  | 'otherIncome'
  | 'section179'
  | 'investmentInterest'
  | 'otherDeductions'

/** Roll-forward bucket. Decides the entry's source_type, and with it the partner capital line. */
export type PassThroughBucket = 'income' | 'gain' | 'deduction'

interface SlotSpec {
  /** The chart subtype it posts to (chart.ts PASS_THROUGH_CHART). */
  subtype: string
  bucket: PassThroughBucket
  /** The lower-tier box it comes from. */
  box: string
  label: string
}

export const PASS_THROUGH_SLOTS: Record<PassThroughSlot, SlotSpec> = {
  ordinary: { subtype: 'passthrough_ordinary', bucket: 'income', box: '1', label: 'Ordinary business income (loss)' },
  rentalRealEstate: { subtype: 'passthrough_rental_real_estate', bucket: 'income', box: '2', label: 'Net rental real estate income (loss)' },
  otherRental: { subtype: 'passthrough_other_rental', bucket: 'income', box: '3', label: 'Other net rental income (loss)' },
  guaranteedPayments: { subtype: 'passthrough_guaranteed_payments', bucket: 'income', box: '4', label: 'Guaranteed payments' },
  interest: { subtype: 'passthrough_interest', bucket: 'income', box: '5', label: 'Interest income' },
  dividends: { subtype: 'passthrough_dividends', bucket: 'income', box: '6a', label: 'Dividends — non-qualified (6a less 6b)' },
  qualifiedDividends: { subtype: 'passthrough_qualified_dividends', bucket: 'income', box: '6b', label: 'Dividends — qualified' },
  royalties: { subtype: 'passthrough_royalties', bucket: 'income', box: '7', label: 'Royalties' },
  shortTermGain: { subtype: 'passthrough_st_gain', bucket: 'gain', box: '8', label: 'Net short-term capital gain (loss)' },
  longTermGain: { subtype: 'passthrough_lt_gain', bucket: 'gain', box: '9a', label: 'Net long-term capital gain (loss)' },
  section1231Gain: { subtype: 'passthrough_1231_gain', bucket: 'gain', box: '10', label: 'Net §1231 gain (loss)' },
  otherIncome: { subtype: 'passthrough_other_income', bucket: 'income', box: '11', label: 'Other income (loss)' },
  section179: { subtype: 'passthrough_section_179', bucket: 'deduction', box: '12', label: '§179 deduction' },
  investmentInterest: { subtype: 'passthrough_investment_interest', bucket: 'deduction', box: '13H', label: 'Investment interest expense' },
  otherDeductions: { subtype: 'passthrough_other_deductions', bucket: 'deduction', box: '13', label: 'Other deductions' },
}

export const PASS_THROUGH_SLOT_LIST = Object.keys(PASS_THROUGH_SLOTS) as PassThroughSlot[]

/** `source_type` per bucket. Mapped to the roll-forward in @portfolio/fund-engine's bucketForSourceType. */
export const PASS_THROUGH_SOURCE_TYPE: Record<PassThroughBucket, string> = {
  income: 'tax_adj_k1_income',
  gain: 'tax_adj_k1_gain',
  deduction: 'tax_adj_k1_deduction',
}

/** The allocation category whose partner terms govern each bucket (terms.ts). */
export const PASS_THROUGH_ALLOCATION_CATEGORY: Record<PassThroughBucket, 'income' | 'realized_gain' | 'partnership_expense'> = {
  income: 'income',
  gain: 'realized_gain',
  deduction: 'partnership_expense',
}

/** The deterministic source_ref every entry for one holding's K-1 carries. */
export function passThroughSourceRef(taxYear: number, companyId: string): string {
  return `${passThroughSourceRefPrefix(taxYear)}${companyId}`
}

/** Every pass-through entry for a year starts with this; a re-run voids exactly those. */
export function passThroughSourceRefPrefix(taxYear: number): string {
  return `tax-k1:${taxYear}:`
}

/** The holding a pass-through source_ref names, or null when it is not one. */
export function companyFromPassThroughRef(sourceRef: string | null | undefined, taxYear: number): string | null {
  const prefix = passThroughSourceRefPrefix(taxYear)
  return sourceRef && sourceRef.startsWith(prefix) ? sourceRef.slice(prefix.length) || null : null
}

export interface PassThroughLine {
  slot: PassThroughSlot
  box: string
  label: string
  /** As reported: income signed, a deduction positive. */
  reported: number
  /** Effect on the holding's tax basis: income and gain as reported, a deduction negated. */
  basisEffect: number
}

/**
 * The postable lines on a K-1, in form order. Zero boxes are left out.
 *
 * 6a and 6b become two lines that ADD to 6a: the qualified part, and the rest. Box 19 and Item L
 * post nothing — distributions are already in the actual book, and Item L is for tie-out.
 */
export function passThroughLines(a: ReceivedK1Amounts): PassThroughLine[] {
  const qualified = roundCents(a.qualifiedDividends ?? 0)
  const reported: Record<PassThroughSlot, number> = {
    ordinary: a.ordinaryBusinessIncome ?? 0,
    rentalRealEstate: a.netRentalRealEstate ?? 0,
    otherRental: a.otherNetRental ?? 0,
    guaranteedPayments: a.guaranteedPayments ?? 0,
    interest: a.interest ?? 0,
    dividends: roundCents((a.ordinaryDividends ?? 0) - qualified),
    qualifiedDividends: qualified,
    royalties: a.royalties ?? 0,
    shortTermGain: a.shortTermGain ?? 0,
    longTermGain: a.longTermGain ?? 0,
    section1231Gain: a.section1231Gain ?? 0,
    otherIncome: a.otherIncome ?? 0,
    section179: a.section179 ?? 0,
    investmentInterest: a.investmentInterest ?? 0,
    otherDeductions: a.otherDeductions ?? 0,
  }
  const out: PassThroughLine[] = []
  for (const slot of PASS_THROUGH_SLOT_LIST) {
    const r = roundCents(reported[slot])
    if (r === 0) continue
    const spec = PASS_THROUGH_SLOTS[slot]
    out.push({ slot, box: spec.box, label: spec.label, reported: r, basisEffect: spec.bucket === 'deduction' ? roundCents(-r) : r })
  }
  return out
}

/** Where a draft posting goes, resolved to an account id by the caller. */
export type AccountRef =
  /** The holding's own account for that character (e.g. 4610-<company>). */
  | { kind: 'slot'; slot: PassThroughSlot }
  /** The holding's pass-through basis account (1700-<company>). */
  | { kind: 'basis' }
  /** 3200 Undistributed earnings. */
  | { kind: 'bridge' }
  /** The holding's own realized-gain account (4000-<company>), for the book-gain reversal. */
  | { kind: 'bookRealized' }
  | { kind: 'capital'; lpEntityId: string }
  /** The single owner's capital account on owner-equity books. */
  | { kind: 'owner' }

export interface DraftPosting {
  account: AccountRef
  /** Debit-positive. */
  amount: number
  lpEntityId?: string | null
}

export interface PassThroughDraft {
  bucket: PassThroughBucket
  sourceType: string
  memo: string
  postings: DraftPosting[]
}

/**
 * How the capital side is posted.
 *
 * `partners`: allocate each bucket across partners by these weights (allocationWeights for the
 * bucket's category). `owner`: all of it to the one owner's capital. `none`: owner books that keep
 * retained earnings, where net income never reaches capital through the bridge.
 */
export type PassThroughCapitalSide =
  | { mode: 'partners'; weights: Record<PassThroughBucket, { lpEntityId: string; commitment: number }[]> }
  | { mode: 'owner' }
  | { mode: 'none' }

export interface BuildPassThroughInput {
  taxYear: number
  holdingName: string
  amounts: ReceivedK1Amounts
  /**
   * The actual book's realized gain on this holding in the year (positive = gain), from its own
   * realized account. Reversed: for tax, the K-1 is the income.
   */
  bookRealizedGain: number
  capital: PassThroughCapitalSide
}

export interface BuildPassThroughResult {
  lines: PassThroughLine[]
  drafts: PassThroughDraft[]
  /** Net movement on the holding's basis account: K-1 income less deductions less the reversed gain. */
  basisChange: number
  /** Set when nothing can be posted for this holding, with the reason. */
  skipped?: string
}

const BUCKET_MEMO: Record<PassThroughBucket, string> = {
  income: 'ordinary income, interest, dividends and other income',
  gain: 'capital and §1231 gain (loss)',
  deduction: 'deductions',
}

/**
 * The capital side of `amount` (a capital EFFECT: positive increases capital).
 *
 * Mirrors the actual book's allocation entry: the bridge takes the debit, each partner's capital
 * the credit. Throws when no partner participates, which the caller turns into a skip — posting
 * the P&L half alone would leave every partner's tax capital short by exactly this.
 */
function capitalPostings(amount: number, bucket: PassThroughBucket, side: PassThroughCapitalSide): DraftPosting[] {
  if (amount === 0 || side.mode === 'none') return []
  if (side.mode === 'owner') {
    return [
      { account: { kind: 'bridge' }, amount, lpEntityId: null },
      { account: { kind: 'owner' }, amount: roundCents(-amount), lpEntityId: null },
    ]
  }
  const weights = side.weights[bucket] ?? []
  if (weights.length === 0 || weights.every(w => !(w.commitment > 0))) {
    throw new Error(`No partner participates in ${PASS_THROUGH_ALLOCATION_CATEGORY[bucket].replace('_', ' ')}, so there is nobody to allocate it to.`)
  }
  const out: DraftPosting[] = [{ account: { kind: 'bridge' }, amount, lpEntityId: null }]
  for (const [lpEntityId, share] of Array.from(allocateAmount(amount, weights).entries())) {
    if (share === 0) continue
    out.push({ account: { kind: 'capital', lpEntityId }, amount: roundCents(-share), lpEntityId })
  }
  return out
}

function checkBalanced(draft: PassThroughDraft): PassThroughDraft {
  // assertBalanced wants a JournalEntry; the account ids are irrelevant to the sum.
  assertBalanced({
    fundId: 'check', entryDate: '2000-01-01', postings: draft.postings.map(p => ({ accountId: 'x', amount: p.amount, currency: 'USD' })),
  } as any)
  return draft
}

/**
 * The tax-book entries for one holding's K-1, as drafts addressed by AccountRef.
 *
 * Balanced by construction and checked anyway. Deterministic: the same amounts and weights always
 * produce the same drafts, which is what lets a re-run void and replace its own entries safely.
 */
export function buildPassThroughDrafts(input: BuildPassThroughInput): BuildPassThroughResult {
  const { taxYear, holdingName, amounts, capital } = input
  const lines = passThroughLines(amounts)
  const bookGain = roundCents(input.bookRealizedGain)
  const drafts: PassThroughDraft[] = []

  try {
    for (const bucket of ['income', 'gain', 'deduction'] as PassThroughBucket[]) {
      const inBucket = lines.filter(l => PASS_THROUGH_SLOTS[l.slot].bucket === bucket)
      if (inBucket.length === 0) continue
      const effect = roundCents(inBucket.reduce((s, l) => s + l.basisEffect, 0))
      const postings: DraftPosting[] = inBucket.map(l => ({
        account: { kind: 'slot', slot: l.slot },
        // Income is a credit (negative); a deduction's negative basis effect makes it a debit.
        amount: roundCents(-l.basisEffect),
        lpEntityId: null,
      }))
      if (effect !== 0) postings.push({ account: { kind: 'basis' }, amount: effect, lpEntityId: null })
      postings.push(...capitalPostings(effect, bucket, capital))
      drafts.push(checkBalanced({
        bucket,
        sourceType: PASS_THROUGH_SOURCE_TYPE[bucket],
        memo: `${taxYear} K-1 from ${holdingName}: ${BUCKET_MEMO[bucket]}`,
        postings,
      }))
    }

    if (bookGain !== 0) {
      drafts.push(checkBalanced({
        bucket: 'gain',
        sourceType: PASS_THROUGH_SOURCE_TYPE.gain,
        memo: `${taxYear} K-1 from ${holdingName}: reverse the book gain on its distributions — for tax a distribution reduces basis and the K-1 is the income`,
        postings: [
          { account: { kind: 'bookRealized' }, amount: bookGain, lpEntityId: null },
          { account: { kind: 'basis' }, amount: roundCents(-bookGain), lpEntityId: null },
          ...capitalPostings(roundCents(-bookGain), 'gain', capital),
        ],
      }))
    }
  } catch (e) {
    return { lines, drafts: [], basisChange: 0, skipped: (e as Error).message }
  }

  const basisChange = roundCents(lines.reduce((s, l) => s + l.basisEffect, 0) - bookGain)
  return { lines, drafts, basisChange }
}

/**
 * Where each pass-through account lands on THIS fund's own K-1s.
 *
 * The payoff of keeping character apart: a holding's interest is this fund's interest (box 5), its
 * qualified dividends this fund's 6b, its §1231 gain this fund's box 10. Two folds are deliberate:
 * guaranteed payments a holding paid this fund are ordinary income to it (box 1), and both dividend
 * accounts make up 6a, with the qualified one also reported as 6b.
 */
export const PASS_THROUGH_K1_CATEGORY: Record<PassThroughSlot, K1Category> = {
  ordinary: 'ordinaryBusinessIncome',
  rentalRealEstate: 'netRentalRealEstate',
  otherRental: 'otherNetRental',
  guaranteedPayments: 'ordinaryBusinessIncome',
  interest: 'interest',
  dividends: 'ordinaryDividends',
  qualifiedDividends: 'ordinaryDividends',
  royalties: 'royalties',
  shortTermGain: 'shortTermGain',
  longTermGain: 'longTermGain',
  section1231Gain: 'section1231Gain',
  otherIncome: 'otherIncome',
  section179: 'section179',
  investmentInterest: 'investmentInterest',
  otherDeductions: 'deductions',
}

/**
 * Each character's movement for the year, as the K-1 shows it (income signed, a deduction positive),
 * from the year's postings. Matched by SUBTYPE over every account — the fund-level parent (4610) and
 * every holding's own sub-account (4610-<company>) alike — so the fund's K-1 boxes total the same
 * whichever of them a line was posted to.
 */
export function passThroughCharacterFromLedger(
  accounts: { id: string; subtype?: string | null }[],
  postings: { accountId: string; amount: number }[],
): Record<PassThroughSlot, number> {
  const slotBySubtype = new Map(PASS_THROUGH_SLOT_LIST.map(s => [PASS_THROUGH_SLOTS[s].subtype, s]))
  const slotByAccount = new Map<string, PassThroughSlot>()
  for (const a of accounts) {
    if (a.subtype && PASS_THROUGH_CHARACTER_SUBTYPES.has(a.subtype)) slotByAccount.set(a.id, slotBySubtype.get(a.subtype)!)
  }
  const sums = Object.fromEntries(PASS_THROUGH_SLOT_LIST.map(s => [s, 0])) as Record<PassThroughSlot, number>
  for (const p of postings) {
    const slot = slotByAccount.get(p.accountId)
    if (slot) sums[slot] += p.amount
  }
  // Income is a credit (negative); a deduction is a debit. Both come back as the K-1 shows them.
  for (const s of PASS_THROUGH_SLOT_LIST) sums[s] = roundCents(PASS_THROUGH_SLOTS[s].bucket === 'deduction' ? sums[s] : -sums[s])
  return sums
}

/**
 * The fund's year character with the pass-through accounts added on their boxes.
 *
 * `pt` is each account's movement for the year as the K-1 shows it: income signed, a deduction
 * positive. Pure, so the mapping above is tested end to end without a ledger (k1-load.ts reads it).
 */
export function withPassThroughCharacter(fund: FundYearCharacter, pt: Partial<Record<PassThroughSlot, number>>): FundYearCharacter {
  const out: FundYearCharacter = { ...fund }
  const add = (key: keyof FundYearCharacter, amount: number) => {
    if (!amount) return
    out[key] = roundCents((out[key] ?? 0) + amount)
  }
  for (const slot of PASS_THROUGH_SLOT_LIST) {
    const amount = roundCents(pt[slot] ?? 0)
    add(PASS_THROUGH_K1_CATEGORY[slot] as keyof FundYearCharacter, amount)
    // 6b is a subset of 6a: the qualified account adds to both.
    if (slot === 'qualifiedDividends') add('qualifiedDividends', amount)
  }
  return out
}
