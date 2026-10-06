// Which call, or which distribution, did this wire settle?
//
// The ledger answers "how much does this partner still owe" (their 1300 balance) and "how much
// are they still owed" (their 2300 balance), and nothing more: a funding entry credits the
// receivable for a partner, not for a call. So a partner with two open calls and one wire has a
// receivable that is half of the two and a register that says nothing about which half.
//
// This decides it the way a bank would: OLDEST FIRST. A partner's settlements are applied to their
// lines in date order, each line taking what it can before the next. It is derived at read time,
// never stored — the register keeps what was asked for, the ledger keeps what arrived, and this is
// the join. Nothing to drift, nothing to backfill, and a corrected wire corrects every status.
//
// A settlement that exceeds every open line (a partner who overpaid, or wired before the call was
// posted) is left over rather than invented onto a line; the receivable balance still shows it.

import { roundCents } from './ledger'

export type LineStatus = 'open' | 'partial' | 'settled'

/** A frozen register line: a partner's amount on one call or distribution. */
export interface RegisterLine {
  id: string
  lpEntityId: string
  /** The call or declaration date. Ordering key for FIFO. */
  date: string
  amount: number
}

/** Money that moved against a partner's receivable or payable. Always positive. */
export interface Settlement {
  entryId?: string
  lpEntityId: string
  date: string
  amount: number
}

export interface SettledLine {
  id: string
  amount: number
  settled: number
  outstanding: number
  status: LineStatus
  /** The date of the settlement that completed the line, once it is complete. */
  settledOn: string | null
  /** The date of the most recent settlement applied to the line, complete or not. */
  lastSettlementOn: string | null
}

const CENT = 0.005

/** Apply each partner's settlements to their lines, oldest line first. Pure. */
export function applySettlements(lines: RegisterLine[], settlements: Settlement[]): Map<string, SettledLine> {
  const out = new Map<string, SettledLine>()

  const linesByLp = new Map<string, RegisterLine[]>()
  for (const l of lines) {
    const arr = linesByLp.get(l.lpEntityId) ?? []
    arr.push(l)
    linesByLp.set(l.lpEntityId, arr)
  }
  const settlementsByLp = new Map<string, Settlement[]>()
  for (const s of settlements) {
    if (!(s.amount > CENT)) continue
    const arr = settlementsByLp.get(s.lpEntityId) ?? []
    arr.push(s)
    settlementsByLp.set(s.lpEntityId, arr)
  }

  for (const [lpEntityId, lpLines] of Array.from(linesByLp.entries())) {
    const ordered = [...lpLines].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
    const pool = [...(settlementsByLp.get(lpEntityId) ?? [])].sort((a, b) => a.date.localeCompare(b.date))
    let poolIndex = 0
    let poolRemaining = pool.length > 0 ? pool[0].amount : 0

    for (const line of ordered) {
      const amount = roundCents(line.amount)
      let settled = 0
      let settledOn: string | null = null
      let lastSettlementOn: string | null = null
      while (settled + CENT < amount && poolIndex < pool.length) {
        const take = roundCents(Math.min(amount - settled, poolRemaining))
        settled = roundCents(settled + take)
        poolRemaining = roundCents(poolRemaining - take)
        if (take > 0) lastSettlementOn = pool[poolIndex].date
        if (settled + CENT >= amount) settledOn = pool[poolIndex].date
        if (poolRemaining <= CENT) {
          poolIndex++
          poolRemaining = poolIndex < pool.length ? pool[poolIndex].amount : 0
        }
      }
      const outstanding = roundCents(Math.max(0, amount - settled))
      const status: LineStatus = outstanding <= CENT ? 'settled' : settled > CENT ? 'partial' : 'open'
      out.set(line.id, { id: line.id, amount, settled, outstanding, status, settledOn: status === 'settled' ? settledOn : null, lastSettlementOn })
    }
  }
  return out
}

export interface SettlementReview {
  lineId: string
  manualAmount: number
  manualDate: string
  separateRemainder: boolean
  links: { entryId: string; amount: number; entryAmount: number; date: string }[]
}

/** Manual amounts remain assigned to their exact line. Only confirmed links exclude overlap. */
export function reconcileSettlements(
  lines: RegisterLine[], ledger: Settlement[], manual: (Settlement & { lineId: string })[],
  reviews: SettlementReview[] = [],
): Map<string, SettledLine & { settlementReview?: string }> {
  const result: Map<string, SettledLine & { settlementReview?: string }> = applySettlements(lines, ledger)
  const manualPartners = new Set(manual.map(payment => payment.lpEntityId))
  for (const lp of manualPartners) {
    const recorded = manual.filter(payment => payment.lpEntityId === lp)
    const bookPayments = ledger.filter(payment => payment.lpEntityId === lp)
    const remaining = bookPayments.map(payment => ({ ...payment }))
    let unresolved = false
    for (const payment of recorded) {
      const review = reviews.find(review => review.lineId === payment.lineId)
      if (!review || Math.abs(review.manualAmount - payment.amount) >= CENT || review.manualDate !== payment.date) {
        if (bookPayments.length || review) unresolved = true
        continue
      }
      let linked = 0
      for (const link of review.links) {
        const entry = remaining.find(entry => entry.entryId === link.entryId)
        const original = bookPayments.find(entry => entry.entryId === link.entryId)
        if (!entry || !original || Math.abs(original.amount - link.entryAmount) >= CENT || original.date !== link.date || link.amount <= 0 || link.amount > entry.amount + CENT) {
          unresolved = true
          continue
        }
        entry.amount = roundCents(entry.amount - link.amount)
        linked = roundCents(linked + link.amount)
      }
      if (linked > payment.amount + CENT || (Math.abs(linked - payment.amount) >= CENT && !review.separateRemainder)) unresolved = true
    }
    const lpLines = lines.filter(line => line.lpEntityId === lp)
    const preserved = new Map(lpLines.map(line => [line.id, applySettlements([line], recorded.filter(payment => payment.lineId === line.id)).get(line.id)!]))
    const additional = applySettlements(lpLines.map(line => ({ ...line, amount: preserved.get(line.id)!.outstanding })), unresolved ? [] : remaining)
    for (const line of lpLines) {
      const manualLine = preserved.get(line.id)!
      const extra = additional.get(line.id)!
      const settled = roundCents(manualLine.settled + extra.settled)
      const outstanding = roundCents(Math.max(0, line.amount - settled))
      const lastSettlementOn = [manualLine.lastSettlementOn, extra.lastSettlementOn].filter((date): date is string => !!date).sort().at(-1) ?? null
      result.set(line.id, {
        ...manualLine, settled, outstanding,
        status: outstanding <= CENT ? 'settled' : settled > CENT ? 'partial' : 'open',
        settledOn: outstanding <= CENT ? lastSettlementOn : null, lastSettlementOn,
        ...(unresolved ? { settlementReview: `Payment reconciliation needed: this partner has ${recorded.reduce((sum, payment) => sum + payment.amount, 0).toFixed(2)} recorded manually and ${bookPayments.reduce((sum, payment) => sum + payment.amount, 0).toFixed(2)} in accounting records. Manual line allocations are retained until the payment representations are matched.` } : {}),
      })
    }
  }
  return result
}

export interface RegisterStatus {
  settlementReview?: string
  status: LineStatus
  settled: number
  outstanding: number
  /** Something is still outstanding past the due date. */
  overdue: boolean
}

/** Roll a call's or distribution's lines up to one status. Pure. */
export function registerStatus(
  lines: (Pick<SettledLine, 'settled' | 'outstanding'> & { settlementReview?: string })[],
  dueDate: string | null | undefined,
  today: string,
): RegisterStatus {
  const settled = roundCents(lines.reduce((s, l) => s + l.settled, 0))
  const outstanding = roundCents(lines.reduce((s, l) => s + l.outstanding, 0))
  const status: LineStatus = outstanding <= CENT ? 'settled' : settled > CENT ? 'partial' : 'open'
  return { ...(lines.some(line => line.settlementReview) ? { settlementReview: 'Payment reconciliation needed' } : {}), status, settled, outstanding, overdue: outstanding > CENT && !!dueDate && dueDate < today }
}

/**
 * Settlements from the posted ledger, for one direction.
 *
 * A call is funded by a CREDIT to the receivable (negative posting) carrying the partner; a
 * distribution is paid by a DEBIT to the payable (positive posting). The issuing and declaring
 * entries post the opposite sign, so a sign filter is the whole distinction.
 */
export function settlementsFromPostings(
  postings: { accountId: string; amount: number; lpEntityId?: string | null; entryDate?: string | null; entryId?: string }[],
  accountId: string,
  direction: 'receivable' | 'payable',
): Settlement[] {
  const out: Settlement[] = []
  const grouped = new Map<string, Settlement>()
  for (const p of postings) {
    if (p.accountId !== accountId || !p.lpEntityId) continue
    const amount = direction === 'receivable' ? -p.amount : p.amount
    const payment = { ...(p.entryId ? { entryId: p.entryId } : {}), lpEntityId: p.lpEntityId, date: p.entryDate ?? '', amount: roundCents(amount) }
    if (p.entryId) {
      const key = `${p.lpEntityId}:${p.entryId}`
      grouped.set(key, { ...payment, amount: roundCents((grouped.get(key)?.amount ?? 0) + amount) })
    } else if (amount > CENT) out.push(payment)
  }
  return [...out, ...[...grouped.values()].filter(payment => payment.amount > CENT)]
}
