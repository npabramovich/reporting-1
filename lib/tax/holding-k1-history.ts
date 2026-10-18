// One fund holding's K-1 income, year by year, as the K-1s it sent reported it.
//
// Read from the amounts recorded on received_k1s (received-k1-amounts.ts), not from the tax book:
// this is what the holding SAID, which is what a reader of the holding's page wants beside its
// register — and it shows a year whose K-1 is entered but not yet posted. Pure, so the column
// folds below are tested without a database (the API route reads the rows).
//
// THE COLUMNS fold the boxes the same way this fund's own K-1s do (k1-passthrough.ts
// PASS_THROUGH_K1_CATEGORY), so the table and the fund's K-1 agree on what "ordinary" means:
//   ordinary     box 1 + box 4 (guaranteed payments paid to this fund are ordinary income to it)
//   interest     box 5
//   dividends    box 6a (qualified dividends, 6b, are part of it)
//   ST / LT gain boxes 8 / 9a
//   other        boxes 2, 3, 7, 10, 11 — rentals, royalties, §1231 and other income
//   deductions   boxes 12, 13H and 13, as the positive amounts the form prints
//   total        the income columns less deductions
//   distributions box 19 (A + C), what the holding paid out, not income

import { roundCents } from '@/lib/accounting/ledger'
import { amountsFromRow, type ReceivedK1Amounts } from './received-k1-amounts'

export interface HoldingK1Year {
  taxYear: number
  /** The entity that received it; null for a K-1 recorded without one. */
  vehicleId: string | null
  status: string
  ordinary: number
  interest: number
  dividends: number
  shortTermGain: number
  longTermGain: number
  other: number
  deductions: number
  total: number
  distributions: number
}

/** The table's columns from one K-1's amounts. */
export function k1YearColumns(a: ReceivedK1Amounts): Omit<HoldingK1Year, 'taxYear' | 'vehicleId' | 'status'> {
  const n = (v: number | undefined) => v ?? 0
  const ordinary = roundCents(n(a.ordinaryBusinessIncome) + n(a.guaranteedPayments))
  const interest = roundCents(n(a.interest))
  const dividends = roundCents(n(a.ordinaryDividends))
  const shortTermGain = roundCents(n(a.shortTermGain))
  const longTermGain = roundCents(n(a.longTermGain))
  const other = roundCents(n(a.netRentalRealEstate) + n(a.otherNetRental) + n(a.royalties) + n(a.section1231Gain) + n(a.otherIncome))
  const deductions = roundCents(n(a.section179) + n(a.investmentInterest) + n(a.otherDeductions))
  const total = roundCents(ordinary + interest + dividends + shortTermGain + longTermGain + other - deductions)
  const distributions = roundCents(n(a.distributionsCash) + n(a.distributionsProperty))
  return { ordinary, interest, dividends, shortTermGain, longTermGain, other, deductions, total, distributions }
}

/**
 * Every year with recorded amounts, newest first, one row per entity that received a K-1.
 *
 * Only K-1s that arrived (received or amended) and have amounts entered; `canSee` decides which
 * entities' rows the viewer may have — a K-1 recorded without an entity is passed as null.
 */
export function holdingK1History(rows: Record<string, unknown>[], canSee: (vehicleId: string | null) => boolean): HoldingK1Year[] {
  const out: HoldingK1Year[] = []
  for (const r of rows) {
    if (r.status !== 'received' && r.status !== 'amended') continue
    const vehicleId = (r.vehicle_id as string | null) ?? null
    if (!canSee(vehicleId)) continue
    const amounts = amountsFromRow(r)
    if (!amounts) continue
    out.push({ taxYear: Number(r.tax_year), vehicleId, status: String(r.status), ...k1YearColumns(amounts) })
  }
  return out.sort((a, b) => b.taxYear - a.taxYear || String(a.vehicleId ?? '').localeCompare(String(b.vehicleId ?? '')))
}
