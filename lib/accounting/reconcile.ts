// Reconciliation: compare the ledger's capital accounts against an external
// source (the existing fund admin's statement), per LP, per line. This is the
// shadow-reconcile wedge — it proves the ledger reproduces the admin's numbers,
// and, when it doesn't, localizes exactly which line and LP disagree.

import type { CapitalAccount } from './capital-account'

/** Lines compared, in statement order. */
export const RECON_LINES: (keyof CapitalAccount)[] = [
  'beginning',
  'contributions',
  'distributions',
  'managementFees',
  'expenses',
  'operatingIncome',
  'realizedGains',
  'unrealizedGains',
  'transfers',
  'carriedInterest',
  'ending',
]

/**
 * Admin statements rarely split income and gains the way the ledger now does, so a
 * payload keyed with the old single `gains` line is folded into the closest line
 * rather than silently dropped. Same for `other` → `carriedInterest`, which is what
 * it held in practice.
 */
const LEGACY_LINES: Record<string, keyof CapitalAccount> = {
  gains: 'realizedGains',
  other: 'carriedInterest',
}

/** Normalize an admin payload that may still use the pre-split line names. */
export function normalizeAdminAccount(admin: Record<string, number | undefined>): AdminCapitalAccount {
  const out: AdminCapitalAccount = {}
  for (const [k, v] of Object.entries(admin)) {
    if (v == null) continue
    const key = (LEGACY_LINES[k] ?? k) as keyof CapitalAccount
    out[key] = (out[key] ?? 0) + v
  }
  return out
}

/** Admin figures for one LP. Any omitted line is skipped in the comparison. */
export type AdminCapitalAccount = Partial<Record<keyof CapitalAccount, number>>

export interface ReconLineDelta {
  lpEntityId: string
  line: keyof CapitalAccount
  ledger: number
  admin: number
  delta: number // ledger - admin
  tiesOut: boolean
}

export interface ReconResult {
  lines: ReconLineDelta[]
  /** LP ids present on both sides. */
  reconciled: string[]
  /** LP ids only in the ledger. */
  ledgerOnly: string[]
  /** LP ids only in the admin statement. */
  adminOnly: string[]
  allTieOut: boolean
  maxAbsDelta: number
}

function r(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/**
 * Reconcile ledger vs admin capital accounts. `tolerance` is the max absolute
 * per-line difference (in major units) still considered a tie-out — default one
 * cent, i.e. exact to the penny.
 */
export function reconcileCapital(
  ledger: Map<string, CapitalAccount>,
  admin: Map<string, AdminCapitalAccount>,
  tolerance = 0.01
): ReconResult {
  const ledgerIds = new Set(ledger.keys())
  const adminIds = new Set(admin.keys())

  const reconciled: string[] = []
  const ledgerOnly: string[] = []
  const adminOnly: string[] = []
  for (const id of Array.from(ledgerIds)) (adminIds.has(id) ? reconciled : ledgerOnly).push(id)
  for (const id of Array.from(adminIds)) if (!ledgerIds.has(id)) adminOnly.push(id)

  const lines: ReconLineDelta[] = []
  let maxAbsDelta = 0
  let allTieOut = ledgerOnly.length === 0 && adminOnly.length === 0

  for (const id of reconciled) {
    const l = ledger.get(id)!
    const a = admin.get(id)!
    for (const line of RECON_LINES) {
      if (a[line] === undefined) continue
      const lv = r(l[line])
      const av = r(a[line] as number)
      const delta = r(lv - av)
      const tiesOut = Math.abs(delta) <= tolerance
      if (!tiesOut) allTieOut = false
      maxAbsDelta = Math.max(maxAbsDelta, Math.abs(delta))
      lines.push({ lpEntityId: id, line, ledger: lv, admin: av, delta, tiesOut })
    }
  }

  return { lines, reconciled, ledgerOnly, adminOnly, allTieOut, maxAbsDelta: r(maxAbsDelta) }
}
